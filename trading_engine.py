from datetime import datetime
from typing import Dict
import json
import config
from utils.timezone import get_current_utc_time_str, get_current_beijing_time_str

class TradingEngine:
    def __init__(self, model_id: int, db, market_fetcher, ai_trader):
        self.model_id = model_id
        self.db = db
        self.market_fetcher = market_fetcher
        self.ai_trader = ai_trader
        self.coins = config.SUPPORTED_COINS

    def _validate_quantity(self, quantity: float, coin: str) -> None:
        """验证交易数量"""
        if not isinstance(quantity, (int, float)):
            raise ValueError(f"Invalid quantity type: {type(quantity)}")
        if quantity <= 0:
            raise ValueError(f"Quantity must be positive, got {quantity}")
        if quantity > 1000:  # 防止异常大的数量
            raise ValueError(f"Quantity too large: {quantity}")

    def _validate_leverage(self, leverage: int) -> None:
        """验证杠杆倍数"""
        if not isinstance(leverage, int):
            raise ValueError(f"Leverage must be integer, got {type(leverage)}")
        if leverage < config.MIN_LEVERAGE or leverage > config.MAX_LEVERAGE:
            raise ValueError(f"Leverage must be between {config.MIN_LEVERAGE} and {config.MAX_LEVERAGE}, got {leverage}")
    
    def execute_trading_cycle(self) -> Dict:
        try:
            market_state = self._get_market_state()

            current_prices = {coin: market_state[coin]['price'] for coin in market_state}

            portfolio = self.db.get_portfolio(self.model_id, current_prices)

            # 检查止盈止损（优先执行）
            stop_results = self._check_stop_loss_take_profit(portfolio, current_prices)

            account_info = self._build_account_info(portfolio)

            # AI决策（返回决策和原始响应）
            decisions, raw_response = self.ai_trader.make_decision(
                market_state, portfolio, account_info
            )

            # 只有在AI返回有效决策时才存储对话记录
            if decisions and len(decisions) > 0:
                # 存储解析后的决策和原始响应
                self.db.add_conversation(
                    self.model_id,
                    user_prompt=self._format_prompt(market_state, portfolio, account_info),
                    ai_response=json.dumps(decisions, ensure_ascii=False),
                    cot_trace=raw_response[:2000] if raw_response else ''  # 限制长度
                )
                print(f'[INFO] Model {self.model_id}: AI decision stored ({len(decisions)} coins)')
            else:
                print(f'[WARN] Model {self.model_id}: AI returned empty decision, skipping conversation storage')
                # 即使决策为空，也记录原始响应用于调试
                if raw_response:
                    print(f'[DEBUG] Raw response preview: {raw_response[:200]}...')

            execution_results = self._execute_decisions(decisions, market_state, portfolio)

            # 合并止盈止损结果
            all_results = stop_results + execution_results

            updated_portfolio = self.db.get_portfolio(self.model_id, current_prices)
            self.db.record_account_value(
                self.model_id,
                updated_portfolio['total_value'],
                updated_portfolio['cash'],
                updated_portfolio['positions_value']
            )

            return {
                'success': True,
                'decisions': decisions,
                'executions': all_results,
                'portfolio': updated_portfolio
            }

        except Exception as e:
            print(f"[ERROR] Trading cycle failed (Model {self.model_id}): {e}")
            import traceback
            print(traceback.format_exc())
            return {
                'success': False,
                'error': str(e)
            }

    def _check_stop_loss_take_profit(self, portfolio: Dict, current_prices: Dict) -> list:
        """
        检查止盈止损条件，自动平仓

        Args:
            portfolio: 投资组合
            current_prices: 当前价格

        Returns:
            执行结果列表
        """
        results = []

        for position in portfolio['positions']:
            coin = position['coin']
            if coin not in current_prices:
                continue

            current_price = current_prices[coin]
            stop_loss = position.get('stop_loss')
            take_profit = position.get('take_profit')
            side = position['side']

            should_close = False
            reason = ''

            # 检查止损
            if stop_loss:
                if side == 'long' and current_price <= stop_loss:
                    should_close = True
                    reason = f'止损触发 (${current_price:.2f} <= ${stop_loss:.2f})'
                elif side == 'short' and current_price >= stop_loss:
                    should_close = True
                    reason = f'止损触发 (${current_price:.2f} >= ${stop_loss:.2f})'

            # 检查止盈
            if take_profit and not should_close:
                if side == 'long' and current_price >= take_profit:
                    should_close = True
                    reason = f'止盈触发 (${current_price:.2f} >= ${take_profit:.2f})'
                elif side == 'short' and current_price <= take_profit:
                    should_close = True
                    reason = f'止盈触发 (${current_price:.2f} <= ${take_profit:.2f})'

            if should_close:
                # 执行平仓
                quantity = position['quantity']
                entry_price = position['avg_price']

                if side == 'long':
                    pnl = (current_price - entry_price) * quantity
                else:
                    pnl = (entry_price - current_price) * quantity

                self.db.close_position(self.model_id, coin, side)
                self.db.add_trade(
                    self.model_id, coin, 'auto_close', quantity,
                    current_price, position['leverage'], side, pnl=pnl
                )

                results.append({
                    'coin': coin,
                    'signal': 'auto_close',
                    'reason': reason,
                    'quantity': quantity,
                    'price': current_price,
                    'pnl': pnl,
                    'message': f'{coin} {reason}, P&L: ${pnl:.2f}'
                })

        return results
    
    def _get_market_state(self) -> Dict:
        market_state = {}
        prices = self.market_fetcher.get_current_prices(self.coins)
        
        for coin in self.coins:
            if coin in prices:
                market_state[coin] = prices[coin].copy()
                indicators = self.market_fetcher.calculate_technical_indicators(coin)
                market_state[coin]['indicators'] = indicators
        
        return market_state
    
    def _build_account_info(self, portfolio: Dict) -> Dict:
        model = self.db.get_model(self.model_id)
        initial_capital = model['initial_capital']
        total_value = portfolio['total_value']
        total_return = ((total_value - initial_capital) / initial_capital) * 100

        return {
            'current_time': get_current_beijing_time_str(),  # AI看到的时间用东八区
            'total_return': total_return,
            'initial_capital': initial_capital
        }
    
    def _format_prompt(self, market_state: Dict, portfolio: Dict, 
                      account_info: Dict) -> str:
        return f"Market State: {len(market_state)} coins, Portfolio: {len(portfolio['positions'])} positions"
    
    def _execute_decisions(self, decisions: Dict, market_state: Dict, 
                          portfolio: Dict) -> list:
        results = []
        
        for coin, decision in decisions.items():
            if coin not in self.coins:
                continue
            
            signal = decision.get('signal', '').lower()
            
            try:
                if signal == 'buy_to_enter':
                    result = self._execute_buy(coin, decision, market_state, portfolio)
                elif signal == 'sell_to_enter':
                    result = self._execute_sell(coin, decision, market_state, portfolio)
                elif signal == 'close_position':
                    result = self._execute_close(coin, decision, market_state, portfolio)
                elif signal == 'hold':
                    result = {'coin': coin, 'signal': 'hold', 'message': 'Hold position'}
                else:
                    result = {'coin': coin, 'error': f'Unknown signal: {signal}'}
                
                results.append(result)
                
            except Exception as e:
                results.append({'coin': coin, 'error': str(e)})
        
        return results
    
    def _execute_buy(self, coin: str, decision: Dict, market_state: Dict,
                    portfolio: Dict) -> Dict:
        try:
            quantity = float(decision.get('quantity', 0))
            leverage = int(decision.get('leverage', 1))
            price = market_state[coin]['price']

            # 输入验证
            self._validate_quantity(quantity, coin)
            self._validate_leverage(leverage)

            required_margin = (quantity * price) / leverage
            if required_margin > portfolio['cash']:
                return {'coin': coin, 'error': 'Insufficient cash'}
        except (ValueError, TypeError) as e:
            return {'coin': coin, 'error': f'Validation failed: {str(e)}'}

        # 获取止盈止损价格
        stop_loss = decision.get('stop_loss')
        take_profit = decision.get('profit_target') or decision.get('take_profit')

        self.db.update_position(
            self.model_id, coin, quantity, price, leverage, 'long',
            stop_loss=stop_loss, take_profit=take_profit
        )

        self.db.add_trade(
            self.model_id, coin, 'buy_to_enter', quantity,
            price, leverage, 'long', pnl=0
        )

        return {
            'coin': coin,
            'signal': 'buy_to_enter',
            'quantity': quantity,
            'price': price,
            'leverage': leverage,
            'stop_loss': stop_loss,
            'take_profit': take_profit,
            'message': f'Long {quantity:.4f} {coin} @ ${price:.2f}'
        }
    
    def _execute_sell(self, coin: str, decision: Dict, market_state: Dict,
                     portfolio: Dict) -> Dict:
        try:
            quantity = float(decision.get('quantity', 0))
            leverage = int(decision.get('leverage', 1))
            price = market_state[coin]['price']

            # 输入验证
            self._validate_quantity(quantity, coin)
            self._validate_leverage(leverage)

            required_margin = (quantity * price) / leverage
            if required_margin > portfolio['cash']:
                return {'coin': coin, 'error': 'Insufficient cash'}
        except (ValueError, TypeError) as e:
            return {'coin': coin, 'error': f'Validation failed: {str(e)}'}

        # 获取止盈止损价格
        stop_loss = decision.get('stop_loss')
        take_profit = decision.get('profit_target') or decision.get('take_profit')

        self.db.update_position(
            self.model_id, coin, quantity, price, leverage, 'short',
            stop_loss=stop_loss, take_profit=take_profit
        )

        self.db.add_trade(
            self.model_id, coin, 'sell_to_enter', quantity,
            price, leverage, 'short', pnl=0
        )

        return {
            'coin': coin,
            'signal': 'sell_to_enter',
            'quantity': quantity,
            'price': price,
            'leverage': leverage,
            'stop_loss': stop_loss,
            'take_profit': take_profit,
            'message': f'Short {quantity:.4f} {coin} @ ${price:.2f}'
        }
    
    def _execute_close(self, coin: str, decision: Dict, market_state: Dict, 
                      portfolio: Dict) -> Dict:
        position = None
        for pos in portfolio['positions']:
            if pos['coin'] == coin:
                position = pos
                break
        
        if not position:
            return {'coin': coin, 'error': 'Position not found'}
        
        current_price = market_state[coin]['price']
        entry_price = position['avg_price']
        quantity = position['quantity']
        side = position['side']
        
        if side == 'long':
            pnl = (current_price - entry_price) * quantity
        else:
            pnl = (entry_price - current_price) * quantity
        
        self.db.close_position(self.model_id, coin, side)
        
        self.db.add_trade(
            self.model_id, coin, 'close_position', quantity,
            current_price, position['leverage'], side, pnl=pnl
        )
        
        return {
            'coin': coin,
            'signal': 'close_position',
            'quantity': quantity,
            'price': current_price,
            'pnl': pnl,
            'message': f'Close {coin}, P&L: ${pnl:.2f}'
        }
