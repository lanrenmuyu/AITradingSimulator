// AI Trading Platform - Home Page
class TradingDashboard {
    constructor() {
        this.chart = null;
        this.refreshInterval = 5000; // 5秒刷新一次
        this.darkMode = false; // 默认白天模式
        this.init();
    }

    async init() {
        // 初始化主题
        this.initTheme();

        // 检查登录状态
        await this.checkLoginStatus();

        // 加载数据
        await this.loadTotalStats();
        await this.loadTopCoins();
        await this.loadPerformanceChart();
        await this.loadRecentTrades();
        await this.loadLeaderboards();

        // 定时刷新
        setInterval(() => this.refresh(), this.refreshInterval);

        // 页脚自动显示/隐藏
        this.initFooterAutoHide();
    }

    initFooterAutoHide() {
        const footer = document.getElementById('pageFooter');
        if (!footer) return;

        let scrollTimeout;
        let isAtBottom = false;

        const checkScroll = () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;

            // 检查是否滚动到底部（距离底部50px以内）
            isAtBottom = (scrollTop + windowHeight) >= (documentHeight - 50);

            if (isAtBottom) {
                footer.classList.add('show');
            } else {
                footer.classList.remove('show');
            }
        };

        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(checkScroll, 100);
        });

        // 初始检查
        checkScroll();
    }

    async checkLoginStatus() {
        try {
            const response = await fetch('/api/user/info', {
                credentials: 'include'
            });

            if (response.ok) {
                // 用户已登录，显示控制面板按钮
                document.getElementById('loginBtn').style.display = 'none';
                document.getElementById('dashboardBtn').style.display = 'flex';
            } else {
                // 用户未登录，显示登录按钮
                document.getElementById('loginBtn').style.display = 'flex';
                document.getElementById('dashboardBtn').style.display = 'none';
            }
        } catch (error) {
            // 出错时默认显示登录按钮
            document.getElementById('loginBtn').style.display = 'flex';
            document.getElementById('dashboardBtn').style.display = 'none';
        }
    }

    initTheme() {
        // 从localStorage读取主题偏好
        const savedTheme = localStorage.getItem('tradingDashboardTheme');
        if (savedTheme === 'dark') {
            this.darkMode = true;
            document.body.classList.add('dark-mode');
            document.getElementById('themeToggle').innerHTML = '<i class="bi bi-moon-fill"></i>';
        }

        // 绑定主题切换按钮
        document.getElementById('themeToggle').addEventListener('click', () => {
            this.toggleTheme();
        });
    }

    toggleTheme() {
        this.darkMode = !this.darkMode;

        if (this.darkMode) {
            document.body.classList.add('dark-mode');
            document.getElementById('themeToggle').innerHTML = '<i class="bi bi-moon-fill"></i>';
            localStorage.setItem('tradingDashboardTheme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            document.getElementById('themeToggle').innerHTML = '<i class="bi bi-sun-fill"></i>';
            localStorage.setItem('tradingDashboardTheme', 'light');
        }

        // 重新渲染图表（适应新主题）
        if (this.chart) {
            this.chart.dispose();
            this.chart = null;
            this.loadPerformanceChart();
        }
    }

    async loadTotalStats() {
        try {
            const response = await fetch('/api/dashboard/total-stats');
            const stats = await response.json();

            const totalValueEl = document.getElementById('totalAccountValue');
            const dailyPnlEl = document.getElementById('dailyPnl');

            totalValueEl.textContent = `总账户价值: $${stats.total_value.toLocaleString()}`;

            const pnlClass = stats.total_pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
            const pnlSign = stats.total_pnl >= 0 ? '+' : '';
            dailyPnlEl.className = pnlClass;
            dailyPnlEl.textContent = `${pnlSign}$${stats.total_pnl.toLocaleString()}`;
        } catch (error) {
            console.error('Failed to load total stats:', error);
        }
    }

    async loadTopCoins() {
        try {
            const response = await fetch('/api/dashboard/top-coins');
            const coins = await response.json();

            const container = document.getElementById('tickerContainer');
            container.innerHTML = coins.map(coin => {
                const changeClass = coin.change_24h >= 0 ? 'positive' : 'negative';
                const changeIcon = coin.change_24h >= 0 ? '▲' : '▼';
                return `
                    <div class="ticker-item">
                        <span class="ticker-symbol">${coin.symbol}</span>
                        <span class="ticker-price">$${coin.price.toLocaleString()}</span>
                        <span class="ticker-change ${changeClass}">
                            ${changeIcon} ${Math.abs(coin.change_24h * 100).toFixed(2)}%
                        </span>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Failed to load top coins:', error);
        }
    }

    async loadPerformanceChart() {
        try {
            const response = await fetch('/api/dashboard/performance-chart');
            const data = await response.json();

            console.log('[DEBUG] Performance chart data:', data);
            console.log('[DEBUG] Models count:', data.length);

            if (data.length > 0) {
                data.forEach(model => {
                    console.log(`[DEBUG] ${model.model_name}: ${model.data.length} data points`);
                });
            }

            if (data.length === 0) {
                console.warn('[WARN] No performance data available');
                // 显示空状态提示
                const chartDom = document.getElementById('performanceChart');
                chartDom.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #999;">暂无收益数据，请先创建交易模型</div>';
                return;
            }

            this.renderChart(data);
            this.renderLegend(data);
        } catch (error) {
            console.error('Failed to load performance chart:', error);
        }
    }

    renderChart(data) {
        const chartDom = document.getElementById('performanceChart');
        if (!this.chart) {
            // 根据当前主题选择图表主题
            const theme = this.darkMode ? 'dark' : null;
            this.chart = echarts.init(chartDom, theme);
        }

        const colors = [
            '#3370FF', '#F7BA1E', '#9FDB1D', '#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181'
        ];

        const series = data.map((model, index) => ({
            name: model.model_name,
            type: 'line',
            data: model.data.map(d => [new Date(d.time).getTime(), d.value]),  // 转换为时间戳
            smooth: true,
            smoothMonotone: 'x',  // 平滑曲线
            showSymbol: false,  // 默认不显示数据点，鼠标悬停时显示
            symbol: 'circle',
            symbolSize: 8,
            lineStyle: {
                width: model.model_id === 'BTC_BASELINE' ? 2 : 3,
                type: model.model_id === 'BTC_BASELINE' ? 'dashed' : 'solid',
                shadowColor: model.model_id === 'BTC_BASELINE' ? 'transparent' : 'rgba(0, 0, 0, 0.1)',
                shadowBlur: 4,
                shadowOffsetY: 2
            },
            itemStyle: {
                color: model.model_id === 'BTC_BASELINE' ? '#999' : colors[index % colors.length],
                borderWidth: 2,
                borderColor: this.darkMode ? '#1a1a1a' : '#fff'
            },
            emphasis: {
                focus: 'series',
                scale: true,
                scaleSize: 12,
                lineStyle: {
                    width: model.model_id === 'BTC_BASELINE' ? 3 : 4
                }
            },
            endLabel: {
                show: true,
                formatter: function (params) {
                    return `${params.seriesName}\n$${params.value[1].toLocaleString()}`;
                },
                fontSize: 11,
                fontWeight: 'bold',
                color: model.model_id === 'BTC_BASELINE' ? '#999' : colors[index % colors.length]
            },
            areaStyle: model.model_id === 'BTC_BASELINE' ? null : {
                color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [{
                        offset: 0,
                        color: colors[index % colors.length] + '20'  // 20% 透明度
                    }, {
                        offset: 1,
                        color: colors[index % colors.length] + '05'  // 5% 透明度
                    }]
                }
            }
        }));

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross',
                    crossStyle: {
                        color: '#999'
                    },
                    lineStyle: {
                        type: 'dashed',
                        width: 1
                    }
                },
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                borderColor: '#333',
                borderWidth: 1,
                textStyle: {
                    color: '#fff',
                    fontSize: 12
                },
                formatter: function (params) {
                    let result = `<div style="font-weight: bold; margin-bottom: 8px;">${new Date(params[0].value[0]).toLocaleString()}</div>`;
                    params.forEach(param => {
                        const color = param.color;
                        const name = param.seriesName;
                        const value = param.value[1];
                        result += `<div style="margin: 4px 0;">
                            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${color}; margin-right: 8px;"></span>
                            <span style="font-weight: 600;">${name}:</span>
                            <span style="color: ${color}; font-weight: bold;">$${value.toLocaleString()}</span>
                        </div>`;
                    });
                    return result;
                }
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                top: '10%',
                containLabel: true
            },
            xAxis: {
                type: 'time',
                boundaryGap: false,
                axisLine: {
                    lineStyle: {
                        color: this.darkMode ? '#333' : '#e0e0e0'
                    }
                },
                splitLine: {
                    show: true,
                    lineStyle: {
                        color: this.darkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                        type: 'dashed',  // 虚线
                        width: 1
                    }
                },
                axisLabel: {
                    color: this.darkMode ? '#999' : '#666'
                }
            },
            yAxis: {
                type: 'value',
                axisLabel: {
                    formatter: '${value}',
                    color: this.darkMode ? '#999' : '#666'
                },
                axisLine: {
                    lineStyle: {
                        color: this.darkMode ? '#333' : '#e0e0e0'
                    }
                },
                splitLine: {
                    lineStyle: {
                        color: this.darkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                        type: 'dashed',  // 虚线
                        width: 1
                    }
                }
            },
            series: series
        };

        this.chart.setOption(option);
    }

    renderLegend(data) {
        const container = document.getElementById('chartLegend');
        const colors = [
            '#3370FF', '#F7BA1E', '#9FDB1D', '#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181'
        ];

        container.innerHTML = data.map((model, index) => {
            const color = model.model_id === 'BTC_BASELINE' ? '#666' : colors[index % colors.length];
            return `
                <div class="legend-item">
                    <span class="legend-color" style="background: ${color};"></span>
                    <span class="legend-name">${model.model_name}</span>
                </div>
            `;
        }).join('');
    }

    async loadRecentTrades() {
        try {
            const response = await fetch('/api/dashboard/recent-trades?limit=100');
            const trades = await response.json();

            console.log('[DEBUG] Recent trades:', trades.length, 'trades');

            const container = document.getElementById('tradesList');

            if (trades.length === 0) {
                container.innerHTML = '<div class="empty-state" style="text-align: center; padding: 40px; color: #999;">暂无交易记录</div>';
                document.getElementById('tradesCount').textContent = '暂无交易';
                return;
            }

            document.getElementById('tradesCount').textContent = `显示最近${trades.length}条交易`;

            container.innerHTML = trades.map(trade => {
                const actionClass = trade.action === 'buy' ? 'buy' : 'sell';
                const actionText = trade.action === 'buy' ? '买入' : '卖出';
                const actionColor = trade.action === 'buy' ? '#22c55e' : '#ef4444';
                const pnlClass = trade.pnl && trade.pnl >= 0 ? 'positive' : 'negative';
                const pnlValue = trade.pnl || 0;

                return `
                    <div class="trade-feed-item">
                        <div class="trade-feed-header">
                            <span class="trade-feed-model">
                                <i class="bi bi-robot"></i> ${trade.model_name}
                            </span>
                            <span class="trade-feed-time">${this.formatTime(trade.created_at)}</span>
                        </div>
                        <div class="trade-feed-content">
                            <span class="trade-feed-action" style="color: ${actionColor}; font-weight: 600;">
                                ${actionText}
                            </span>
                            <span class="trade-feed-coin" style="font-weight: 600;">
                                ${trade.coin}
                            </span>
                        </div>
                        <div class="trade-feed-details">
                            <div class="trade-feed-detail-item">
                                <span class="detail-label">价格:</span>
                                <span class="detail-value">$${trade.price.toLocaleString()}</span>
                            </div>
                            <div class="trade-feed-detail-item">
                                <span class="detail-label">数量:</span>
                                <span class="detail-value">${trade.quantity.toFixed(4)}</span>
                            </div>
                            ${trade.pnl !== null && trade.pnl !== 0 ? `
                                <div class="trade-feed-detail-item">
                                    <span class="detail-label">盈亏:</span>
                                    <span class="detail-value ${pnlClass}" style="font-weight: 700;">
                                        ${pnlValue >= 0 ? '+' : ''}$${pnlValue.toFixed(2)}
                                    </span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Failed to load recent trades:', error);
        }
    }


    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString();
    }

    async loadLeaderboards() {
        // 加载详细排行榜
        await this.loadDetailedLeaderboard();

        // 加载高级分析数据
        await this.loadAdvancedAnalytics();

        // 绑定tab切换事件
        this.bindStatsTabsEvents();
    }

    async loadDetailedLeaderboard() {
        try {
            const response = await fetch('/api/dashboard/detailed-leaderboard');
            const data = await response.json();

            // 渲染表格
            const tbody = document.getElementById('overallStatsBody');
            tbody.innerHTML = data.map((model, index) => {
                const rank = index + 1;
                const returnClass = model.return_pct >= 0 ? 'positive' : 'negative';
                const pnlClass = model.total_pnl >= 0 ? 'positive' : 'negative';
                const winClass = model.biggest_win >= 0 ? 'positive' : '';
                const lossClass = model.biggest_loss < 0 ? 'negative' : '';

                return `
                    <tr>
                        <td>${rank}</td>
                        <td>
                            <div class="model-name">
                                <div class="model-icon" style="background: ${this.getModelColor(index)};">
                                    ${this.getModelEmoji(model.name)}
                                </div>
                                <span>${model.name}</span>
                            </div>
                        </td>
                        <td class="${returnClass}"><strong>${model.return_pct >= 0 ? '+' : ''}${model.return_pct.toFixed(2)}%</strong></td>
                        <td>$${model.total_value.toLocaleString()}</td>
                        <td class="${pnlClass}">${model.total_pnl >= 0 ? '+' : ''}$${model.total_pnl.toLocaleString()}</td>
                        <td>$${model.fees.toFixed(2)}</td>
                        <td>${model.win_rate.toFixed(1)}%</td>
                        <td class="${winClass}">$${model.biggest_win.toFixed(2)}</td>
                        <td class="${lossClass}">$${model.biggest_loss.toFixed(2)}</td>
                        <td>${model.sharpe.toFixed(3)}</td>
                        <td>${model.trades}</td>
                    </tr>
                `;
            }).join('');

            // 更新获胜模型信息
            if (data.length > 0) {
                const winner = data[0];
                document.getElementById('winningModelName').textContent = winner.name;
                document.getElementById('winningModelEquity').textContent = `$${winner.total_value.toLocaleString()}`;
                document.getElementById('winningModelPositions').textContent = winner.trades;
            }

            // 渲染柱状图
            this.renderStatsChart(data.slice(0, 6));
        } catch (error) {
            console.error('Failed to load detailed leaderboard:', error);
        }
    }

    async loadAdvancedAnalytics() {
        try {
            const response = await fetch('/api/dashboard/advanced-analytics');
            const data = await response.json();

            // 渲染高级分析表格
            const tbody = document.getElementById('advancedAnalyticsBody');

            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 40px; color: #86909c;">暂无数据</td></tr>';
                return;
            }

            tbody.innerHTML = data.map((model, index) => {
                const rank = index + 1;
                const sharpeClass = model.sharpe >= 0 ? 'positive' : 'negative';
                const sortinoClass = model.sortino >= 0 ? 'positive' : 'negative';
                const calmarClass = model.calmar >= 0 ? 'positive' : 'negative';
                const drawdownClass = 'negative';
                const volatilityClass = '';
                const avgWinClass = model.avg_win > 0 ? 'positive' : '';
                const avgLossClass = model.avg_loss < 0 ? 'negative' : '';
                const profitFactorClass = model.profit_factor >= 1 ? 'positive' : 'negative';

                return `
                    <tr>
                        <td>${rank}</td>
                        <td>
                            <div class="model-name">
                                <div class="model-icon" style="background: ${this.getModelColor(index)};">
                                    ${this.getModelEmoji(model.name)}
                                </div>
                                <span>${model.name}</span>
                            </div>
                        </td>
                        <td class="${sharpeClass}">${model.sharpe.toFixed(3)}</td>
                        <td class="${sortinoClass}">${model.sortino.toFixed(3)}</td>
                        <td class="${calmarClass}">${model.calmar.toFixed(3)}</td>
                        <td class="${drawdownClass}">${model.max_drawdown.toFixed(2)}%</td>
                        <td class="${volatilityClass}">${model.volatility.toFixed(2)}%</td>
                        <td class="${avgWinClass}">$${model.avg_win.toFixed(2)}</td>
                        <td class="${avgLossClass}">$${model.avg_loss.toFixed(2)}</td>
                        <td class="${profitFactorClass}">${model.profit_factor.toFixed(2)}</td>
                        <td>${model.trades}</td>
                    </tr>
                `;
            }).join('');
        } catch (error) {
            console.error('Failed to load advanced analytics:', error);
            const tbody = document.getElementById('advancedAnalyticsBody');
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 40px; color: #f53f3f;">加载失败</td></tr>';
        }
    }

    getModelColor(index) {
        const colors = ['#5470c6', '#fc8452', '#000', '#9a60b4', '#3ba272', '#ea7ccc'];
        return colors[index % colors.length];
    }

    getModelEmoji(name) {
        const emojis = {
            'DEEPSEEK': '🤖',
            'CLAUDE': '🧠',
            'GROK': '⚡',
            'QWEN': '🎯',
            'GEMINI': '💎',
            'GPT': '🚀'
        };

        for (const [key, emoji] of Object.entries(emojis)) {
            if (name.toUpperCase().includes(key)) {
                return emoji;
            }
        }
        return '📊';
    }

    renderStatsChart(data) {
        const chartDom = document.getElementById('statsChart');
        const myChart = echarts.init(chartDom);

        const option = {
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                top: '10%',
                containLabel: true
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'shadow'
                },
                formatter: function (params) {
                    const value = params[0].value;
                    const sign = value >= 0 ? '+' : '';
                    return `${params[0].name}<br/>收益率: ${sign}${value.toFixed(2)}%`;
                }
            },
            xAxis: {
                type: 'category',
                data: data.map(m => m.name),
                axisLabel: {
                    rotate: 45,
                    fontSize: 10
                }
            },
            yAxis: {
                type: 'value',
                axisLabel: {
                    formatter: function (value) {
                        const sign = value >= 0 ? '+' : '';
                        return sign + value.toFixed(1) + '%';
                    }
                }
            },
            series: [{
                data: data.map((m, i) => ({
                    value: m.return_pct,  // 改为收益率
                    itemStyle: {
                        color: m.return_pct >= 0 ? '#00b578' : '#ff4d4f'  // 正收益绿色，负收益红色
                    }
                })),
                type: 'bar',
                barWidth: '60%',
                label: {
                    show: true,
                    position: 'top',
                    formatter: function (params) {
                        const sign = params.value >= 0 ? '+' : '';
                        return sign + params.value.toFixed(2) + '%';
                    }
                }
            }]
        };

        myChart.setOption(option);
    }

    bindStatsTabsEvents() {
        document.querySelectorAll('.stats-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                // 切换tab激活状态
                document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');

                // 切换内容显示
                const tabName = e.target.dataset.tab;
                document.querySelectorAll('.stats-content').forEach(content => {
                    content.classList.remove('active');
                });
                document.getElementById(tabName === 'overall' ? 'overallStats' : 'advancedAnalytics').classList.add('active');
            });
        });
    }


    async refresh() {
        await Promise.all([
            this.loadTotalStats(),
            this.loadTopCoins(),
            this.loadPerformanceChart(),
            this.loadRecentTrades(),
            this.loadLeaderboards()
        ]);
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new TradingDashboard();
});

