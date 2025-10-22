"""
回测系统
用历史数据测试AI交易策略的表现
"""
from typing import Dict, List
from datetime import datetime, timedelta
import config


class Backtester:
    """回测引擎"""
    
    def __init__(self, db, market_fetcher, ai_trader):
        self.db = db
        self.market_fetcher = market_fetcher
        self.ai_trader = ai_trader
    
    def run_backtest(self, model_config: Dict, start_date: str, end_date: str, 
                     initial_capital: float = 10000) -> Dict:
        """
        运行回测
        
        Args:
            model_config: AI模型配置 {'api_key': ..., 'api_url': ..., 'model_name': ...}
            start_date: 开始日期 'YYYY-MM-DD'
            end_date: 结束日期 'YYYY-MM-DD'
            initial_capital: 初始资金
            
        Returns:
            回测结果
        """
        # 初始化回测状态
        portfolio = {
            'cash': initial_capital,
            'positions': [],
            'total_value': initial_capital
        }
        
        trades = []
        daily_values = []
        
        # 获取历史数据
        start = datetime.strptime(start_date, '%Y-%m-%d')
        end = datetime.strptime(end_date, '%Y-%m-%d')
        current = start
        
        print(f"📊 开始回测：{start_date} 到 {end_date}")
        
        while current <= end:
            date_str = current.strftime('%Y-%m-%d')
            
            # 获取当天的市场数据
            market_data = self._get_historical_market_data(date_str)
            
            if not market_data:
                current += timedelta(days=1)
                continue
            
            # 更新持仓价值
            self._update_portfolio_value(portfolio, market_data)
            
            # AI做决策
            decision = self._make_trading_decision(
                model_config, portfolio, market_data
            )
            
            # 执行交易
            if decision and decision.get('signal') != 'hold':
                trade_result = self._execute_backtest_trade(
                    portfolio, decision, market_data
                )
                if trade_result:
                    trades.append({
                        'date': date_str,
                        **trade_result
                    })
            
            # 记录每日净值
            daily_values.append({
                'date': date_str,
                'total_value': portfolio['total_value'],
                'cash': portfolio['cash'],
                'positions_count': len(portfolio['positions'])
            })
            
            current += timedelta(days=1)
        
        # 计算回测指标
        metrics = self._calculate_backtest_metrics(
            trades, daily_values, initial_capital
        )
        
        return {
            'start_date': start_date,
            'end_date': end_date,
            'initial_capital': initial_capital,
            'final_value': portfolio['total_value'],
            'total_return': ((portfolio['total_value'] - initial_capital) / initial_capital) * 100,
            'trades': trades,
            'daily_values': daily_values,
            'metrics': metrics
        }
    
    def _get_historical_market_data(self, date: str) -> Dict:
        """获取历史市场数据"""
        prices = {}
        
        for coin in config.SUPPORTED_COINS:
            # 获取历史价格
            historical = self.market_fetcher.get_historical_prices(coin, days=30)
            
            if historical:
                # 简化：使用最新价格作为当天价格
                prices[coin] = {
                    'price': historical[-1]['price'],
                    'volume': historical[-1].get('volume', 0)
                }
        
        return prices if prices else None
    
    def _update_portfolio_value(self, portfolio: Dict, market_data: Dict):
        """更新投资组合价值"""
        total_value = portfolio['cash']
        
        for position in portfolio['positions']:
            coin = position['coin']
            if coin in market_data:
                position_value = position['quantity'] * market_data[coin]['price']
                total_value += position_value
        
        portfolio['total_value'] = total_value
    
    def _make_trading_decision(self, model_config: Dict, portfolio: Dict, 
                               market_data: Dict) -> Dict:
        """AI做交易决策"""
        try:
            # 构建市场状态
            market_state = {
                'prices': {coin: data['price'] for coin, data in market_data.items()},
                'portfolio': portfolio
            }
            
            # 获取技术指标（简化版）
            indicators = {}
            for coin in config.SUPPORTED_COINS:
                indicators[coin] = self.market_fetcher.calculate_technical_indicators(coin)
            
            # AI决策
            decision = self.ai_trader.make_decision(
                market_state, indicators, portfolio
            )
            
            return decision
        except Exception as e:
            print(f"❌ AI决策失败: {e}")
            return None
    
    def _execute_backtest_trade(self, portfolio: Dict, decision: Dict, 
                                market_data: Dict) -> Dict:
        """执行回测交易"""
        signal = decision.get('signal')
        coin = decision.get('coin')
        quantity = decision.get('quantity', 0)
        leverage = decision.get('leverage', 1)
        
        if not coin or coin not in market_data:
            return None
        
        price = market_data[coin]['price']
        
        if signal == 'buy':
            # 买入
            required_cash = (quantity * price) / leverage
            
            if required_cash > portfolio['cash']:
                return None
            
            portfolio['cash'] -= required_cash
            portfolio['positions'].append({
                'coin': coin,
                'quantity': quantity,
                'avg_price': price,
                'leverage': leverage,
                'side': 'long'
            })
            
            return {
                'signal': 'buy',
                'coin': coin,
                'quantity': quantity,
                'price': price,
                'leverage': leverage
            }
        
        elif signal == 'sell':
            # 卖出（平仓）
            position = next((p for p in portfolio['positions'] if p['coin'] == coin), None)
            
            if not position:
                return None
            
            # 计算盈亏
            pnl = (price - position['avg_price']) * position['quantity'] * position['leverage']
            
            portfolio['cash'] += (position['quantity'] * position['avg_price']) / position['leverage'] + pnl
            portfolio['positions'].remove(position)
            
            return {
                'signal': 'sell',
                'coin': coin,
                'quantity': position['quantity'],
                'price': price,
                'pnl': pnl
            }
        
        return None
    
    def _calculate_backtest_metrics(self, trades: List[Dict], 
                                    daily_values: List[Dict], 
                                    initial_capital: float) -> Dict:
        """计算回测指标"""
        if not daily_values:
            return {}
        
        # 总收益率
        final_value = daily_values[-1]['total_value']
        total_return = ((final_value - initial_capital) / initial_capital) * 100
        
        # 交易次数
        total_trades = len(trades)
        
        # 胜率
        winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
        win_rate = (len(winning_trades) / total_trades * 100) if total_trades > 0 else 0
        
        # 最大回撤
        max_drawdown = self._calculate_max_drawdown([d['total_value'] for d in daily_values])
        
        # 夏普比率（简化版）
        returns = []
        for i in range(1, len(daily_values)):
            daily_return = (daily_values[i]['total_value'] - daily_values[i-1]['total_value']) / daily_values[i-1]['total_value']
            returns.append(daily_return)
        
        if returns:
            avg_return = sum(returns) / len(returns)
            std_return = (sum((r - avg_return) ** 2 for r in returns) / len(returns)) ** 0.5
            sharpe_ratio = (avg_return / std_return * (252 ** 0.5)) if std_return > 0 else 0
        else:
            sharpe_ratio = 0
        
        # 平均盈亏
        pnls = [t.get('pnl', 0) for t in trades if 'pnl' in t]
        avg_pnl = sum(pnls) / len(pnls) if pnls else 0
        
        return {
            'total_return': total_return,
            'total_trades': total_trades,
            'win_rate': win_rate,
            'max_drawdown': max_drawdown,
            'sharpe_ratio': sharpe_ratio,
            'avg_pnl': avg_pnl,
            'final_value': final_value
        }
    
    def _calculate_max_drawdown(self, values: List[float]) -> float:
        """计算最大回撤"""
        if not values:
            return 0.0
        
        peak = values[0]
        max_dd = 0.0
        
        for value in values:
            if value > peak:
                peak = value
            
            dd = (peak - value) / peak if peak > 0 else 0
            max_dd = max(max_dd, dd)
        
        return max_dd

