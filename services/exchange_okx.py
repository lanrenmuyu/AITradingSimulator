# exchange_okx.py
import ccxt
import time
import logging

logger = logging.getLogger(__name__)

class OKXExchange:
    def __init__(self, api_key=None, api_secret=None, passphrase=None, sandbox=False):
        """
        api_key, api_secret, passphrase 可以从 config.py 或环境变量读取
        sandbox=True 时会尝试连接 OKX 模拟网关（ccxt 支持 sandbox 并非对所有交易所均可）
        """
        exchange_id = 'okx'  # ccxt 的 id
        params = {}
        if sandbox:
            # ccxt okx 参数： 'enableRateLimit': True, 'options': {'defaultType': 'swap'} 等
            params['enableRateLimit'] = True
            # ccxt 的 sandbox 通常用 exchange.set_sandbox_mode(True)
        self.exchange = getattr(ccxt, exchange_id)({
            'apiKey': api_key or '',
            'secret': api_secret or '',
            'password': passphrase or '',
            'enableRateLimit': True,
            # 'timeout': 10000,
        })
        if sandbox:
            try:
                self.exchange.set_sandbox_mode(True)
            except Exception as e:
                logger.warning("set_sandbox_mode failed: %s", e)

    # =========== Market data ===========
    def fetch_ticker(self, symbol):
        """symbol 格式：'BTC/USDT'"""
        return self.exchange.fetch_ticker(symbol)

    def fetch_ohlcv(self, symbol, timeframe='1m', since=None, limit=200):
        """返回 OHLCV 列表，ccxt 标准 (timestamp, open, high, low, close, volume)"""
        return self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since, limit=limit)

    # =========== Account / balance ===========
    def fetch_balance(self):
        return self.exchange.fetch_balance()

    # =========== Orders ===========
    def create_order(self, symbol, side, type_, amount, price=None, params=None):
        """
        side: 'buy' or 'sell'
        type_: 'market' or 'limit'
        params: exchange specific params (eg. {'reduceOnly': False, 'positionSide': 'long'})
        """
        if params is None:
            params = {}
        if type_ == 'market':
            # For market, many exchanges don't want price
            order = self.exchange.create_order(symbol, type_, side, amount, price, params)
        else:
            order = self.exchange.create_order(symbol, type_, side, amount, price, params)
        return order

    def cancel_order(self, order_id, symbol=None):
        return self.exchange.cancel_order(order_id, symbol)

    def fetch_open_orders(self, symbol=None):
        return self.exchange.fetch_open_orders(symbol)

    # =========== Utilities ===========
    def load_markets(self):
        self.exchange.load_markets()

    def symbol_info(self, symbol):
        return self.exchange.markets.get(symbol)

