class TradingApp {
    constructor() {
        this.currentModelId = null;
        this.currentUser = null;
        this.chart = null;
        this.klineChart = null;
        this.currentKlineCoin = 'BTC';
        this.klineColorMode = 'red-up'; // 默认红涨绿跌
        this.refreshIntervals = {
            market: null,
            portfolio: null,
            trades: null
        };
        this.init();
    }

    async init() {
        // 检查登录状态
        await this.checkAuth();

        this.initEventListeners();
        this.initKlineChart();
        this.loadModels();
        this.loadMarketPrices();
        this.startRefreshCycles();
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/me', {
                credentials: 'include'
            });

            if (response.ok) {
                this.currentUser = await response.json();
                this.updateUserInfo();
            } else {
                // 未登录，跳转到登录页
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/login';
        }
    }

    updateUserInfo() {
        const userInfoEl = document.getElementById('userInfo');
        if (userInfoEl && this.currentUser) {
            userInfoEl.textContent = `欢迎, ${this.currentUser.username}`;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    initEventListeners() {
        document.getElementById('addModelBtn').addEventListener('click', () => this.showModal());
        document.getElementById('closeModalBtn').addEventListener('click', () => this.hideModal());
        document.getElementById('cancelBtn').addEventListener('click', () => this.hideModal());
        document.getElementById('submitBtn').addEventListener('click', () => this.submitModel());
        document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());
        document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        document.getElementById('klineSelect').addEventListener('change', (e) => {
            this.currentKlineCoin = e.target.value;
            this.loadKlineData();
        });

        document.getElementById('klineColorToggle').addEventListener('click', () => {
            this.toggleKlineColor();
        });

        // 加载保存的主题
        this.loadTheme();
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
            window.location.href = '/login';
        } catch (error) {
            console.error('Logout failed:', error);
            window.location.href = '/login';
        }
    }

    async loadModels() {
        try {
            const response = await fetch('/api/models', {
                credentials: 'include'
            });

            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }

            const models = await response.json();
            this.renderModels(models);

            if (models.length > 0 && !this.currentModelId) {
                this.selectModel(models[0].id);
            }
        } catch (error) {
            console.error('Failed to load models:', error);
        }
    }

    renderModels(models) {
        const container = document.getElementById('modelList');
        
        if (models.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无模型</div>';
            return;
        }

        container.innerHTML = models.map(model => `
            <div class="model-item ${model.id === this.currentModelId ? 'active' : ''}"
                 onclick="app.selectModel(${model.id})">
                <div class="model-name">${model.name}</div>
                <div class="model-info">
                    <span>${model.model_name}</span>
                    <div class="model-actions">
                        <span class="model-edit" onclick="event.stopPropagation(); app.editModel(${model.id})" title="编辑策略">
                            <i class="bi bi-pencil"></i>
                        </span>
                        <span class="model-delete" onclick="event.stopPropagation(); app.deleteModel(${model.id})" title="删除模型">
                            <i class="bi bi-trash"></i>
                        </span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async selectModel(modelId) {
        this.currentModelId = modelId;
        this.loadModels();
        await this.loadModelData();
    }

    async loadModelData() {
        if (!this.currentModelId) return;

        try {
            // 添加超时控制
            const timeout = (ms) => new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), ms)
            );

            const fetchWithTimeout = (url, ms = 10000) =>
                Promise.race([
                    fetch(url, { credentials: 'include' }),
                    timeout(ms)
                ]);

            const [portfolioRes, tradesRes, conversationsRes] = await Promise.all([
                fetchWithTimeout(`/api/models/${this.currentModelId}/portfolio`),
                fetchWithTimeout(`/api/models/${this.currentModelId}/trades?limit=50`),
                fetchWithTimeout(`/api/models/${this.currentModelId}/conversations?limit=20`)
            ]);

            // 检查响应状态
            if (portfolioRes.status === 401 || tradesRes.status === 401 || conversationsRes.status === 401) {
                console.warn('Session expired, redirecting to login...');
                window.location.href = '/login';
                return;
            }

            const [portfolio, trades, conversations] = await Promise.all([
                portfolioRes.json(),
                tradesRes.json(),
                conversationsRes.json()
            ]);

            this.updateStats(portfolio.portfolio);
            this.updateChart(portfolio.account_value_history, portfolio.portfolio.total_value);
            this.updatePositions(portfolio.portfolio.positions);
            this.updateTrades(trades);
            this.updateConversations(conversations);
        } catch (error) {
            console.error('Failed to load model data:', error);

            // 显示错误提示
            if (error.message === 'Request timeout') {
                console.warn('Request timeout, retrying...');
                // 3秒后重试
                setTimeout(() => this.loadModelData(), 3000);
            } else if (error.message.includes('Failed to fetch')) {
                console.error('Network error, please check your connection');
            }
        }
    }

    updateStats(portfolio) {
        const stats = [
            { value: portfolio.total_value || 0, class: portfolio.total_value > portfolio.initial_capital ? 'positive' : portfolio.total_value < portfolio.initial_capital ? 'negative' : '' },
            { value: portfolio.cash || 0, class: '' },
            { value: portfolio.realized_pnl || 0, class: portfolio.realized_pnl > 0 ? 'positive' : portfolio.realized_pnl < 0 ? 'negative' : '' },
            { value: portfolio.unrealized_pnl || 0, class: portfolio.unrealized_pnl > 0 ? 'positive' : portfolio.unrealized_pnl < 0 ? 'negative' : '' }
        ];

        document.querySelectorAll('.stat-value').forEach((el, index) => {
            if (stats[index]) {
                el.textContent = `$${Math.abs(stats[index].value).toFixed(2)}`;
                el.className = `stat-value ${stats[index].class}`;
            }
        });
    }

    updateChart(history, currentValue) {
        const chartDom = document.getElementById('accountChart');
        
        if (!this.chart) {
            this.chart = echarts.init(chartDom);
            window.addEventListener('resize', () => {
                if (this.chart) {
                    this.chart.resize();
                }
            });
        }

        const data = history.reverse().map(h => ({
            // 后端返回ISO 8601格式（带时区），JavaScript会自动转换成本地时区
            time: new Date(h.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            }),
            value: h.total_value
        }));

        if (currentValue !== undefined && currentValue !== null) {
            const now = new Date();
            const currentTime = now.toLocaleTimeString('zh-CN', { 
                timeZone: 'Asia/Shanghai',
                hour: '2-digit', 
                minute: '2-digit' 
            });
            data.push({
                time: currentTime,
                value: currentValue
            });
        }

        const option = {
            grid: {
                left: '60',
                right: '20',
                bottom: '30',
                top: '20',
                containLabel: false
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: data.map(d => d.time),
                axisLine: { lineStyle: { color: '#e5e6eb' } },
                axisLabel: { color: '#86909c', fontSize: 11 }
            },
            yAxis: {
                type: 'value',
                scale: true,
                axisLine: { lineStyle: { color: '#e5e6eb' } },
                axisLabel: { 
                    color: '#86909c', 
                    fontSize: 11,
                    formatter: (value) => `$${value.toLocaleString()}`
                },
                splitLine: { lineStyle: { color: '#f2f3f5' } }
            },
            series: [{
                type: 'line',
                data: data.map(d => d.value),
                smooth: true,
                symbol: 'none',
                lineStyle: { color: '#3370ff', width: 2 },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(51, 112, 255, 0.2)' },
                            { offset: 1, color: 'rgba(51, 112, 255, 0)' }
                        ]
                    }
                }
            }],
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                borderColor: '#e5e6eb',
                borderWidth: 1,
                textStyle: { color: '#1d2129' },
                formatter: (params) => {
                    const value = params[0].value;
                    return `${params[0].axisValue}<br/>$${value.toFixed(2)}`;
                }
            }
        };

        this.chart.setOption(option);
        
        setTimeout(() => {
            if (this.chart) {
                this.chart.resize();
            }
        }, 100);
    }

    updatePositions(positions) {
        const tbody = document.getElementById('positionsBody');
        
        if (positions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无持仓</td></tr>';
            return;
        }

        tbody.innerHTML = positions.map(pos => {
            const sideClass = pos.side === 'long' ? 'badge-long' : 'badge-short';
            const sideText = pos.side === 'long' ? '做多' : '做空';
            
            const currentPrice = pos.current_price !== null && pos.current_price !== undefined 
                ? `$${pos.current_price.toFixed(2)}` 
                : '-';
            
            let pnlDisplay = '-';
            let pnlClass = '';
            if (pos.pnl !== undefined && pos.pnl !== 0) {
                pnlClass = pos.pnl > 0 ? 'text-success' : 'text-danger';
                pnlDisplay = `${pos.pnl > 0 ? '+' : ''}$${pos.pnl.toFixed(2)}`;
            }
            
            return `
                <tr>
                    <td><strong>${pos.coin}</strong></td>
                    <td><span class="badge ${sideClass}">${sideText}</span></td>
                    <td>${pos.quantity.toFixed(4)}</td>
                    <td>$${pos.avg_price.toFixed(2)}</td>
                    <td>${currentPrice}</td>
                    <td>${pos.leverage}x</td>
                    <td class="${pnlClass}"><strong>${pnlDisplay}</strong></td>
                </tr>
            `;
        }).join('');
    }

    updateTrades(trades) {
        const tbody = document.getElementById('tradesBody');
        
        if (trades.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无交易记录</td></tr>';
            return;
        }

        tbody.innerHTML = trades.map(trade => {
            const signalMap = {
                'buy_to_enter': { badge: 'badge-buy', text: '开多' },
                'sell_to_enter': { badge: 'badge-sell', text: '开空' },
                'close_position': { badge: 'badge-close', text: '平仓' }
            };
            const signal = signalMap[trade.signal] || { badge: '', text: trade.signal };
            const pnlClass = trade.pnl > 0 ? 'text-success' : trade.pnl < 0 ? 'text-danger' : '';

            return `
                <tr>
                    <td>${new Date(trade.timestamp).toLocaleString('zh-CN')}</td>
                    <td><strong>${trade.coin}</strong></td>
                    <td><span class="badge ${signal.badge}">${signal.text}</span></td>
                    <td>${trade.quantity.toFixed(4)}</td>
                    <td>$${trade.price.toFixed(2)}</td>
                    <td class="${pnlClass}">$${trade.pnl.toFixed(2)}</td>
                </tr>
            `;
        }).join('');
    }

    updateConversations(conversations) {
        const container = document.getElementById('conversationsBody');

        if (conversations.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无对话记录</div>';
            return;
        }

        container.innerHTML = conversations.map(conv => {
            // 解析AI响应，提取决策信息
            const response = conv.ai_response;
            let decision = '观望';
            let marketAnalysis = '';
            let reasoning = '';
            let confidence = '';
            let parsedData = null;
            let coinData = null;

            // 尝试解析JSON格式的响应（支持多种格式）
            try {
                // 方法1: 直接解析整个响应
                try {
                    parsedData = JSON.parse(response);
                } catch (e1) {
                    // 方法2: 提取JSON对象
                    const jsonMatch = response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        parsedData = JSON.parse(jsonMatch[0]);
                    }
                }

                if (parsedData) {
                    // 检查是否是嵌套格式：{"BTC": {"signal": "hold", "reasoning": {...}}}
                    const coinKeys = ['BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'XRP'];
                    for (const coin of coinKeys) {
                        if (parsedData[coin]) {
                            coinData = parsedData[coin];
                            break;
                        }
                    }

                    // 如果是嵌套格式，使用coinData
                    const data = coinData || parsedData;

                    // 提取决策（支持多种字段名）
                    decision = data.decision || data.action || data.signal || '观望';

                    // 映射signal到中文
                    if (decision === 'buy') decision = '买入';
                    else if (decision === 'sell') decision = '卖出';
                    else if (decision === 'hold') decision = '持有';

                    // 提取市场分析
                    if (data.reasoning && typeof data.reasoning === 'object') {
                        // reasoning是对象格式
                        marketAnalysis = data.reasoning.market_analysis || '';
                        reasoning = data.reasoning.decision_rationale || data.reasoning.reasoning || '';
                    } else {
                        // reasoning是字符串格式
                        marketAnalysis = data.market_analysis || data.analysis ||
                                       data.market_condition || data.market || '';
                        reasoning = data.reasoning || data.reason ||
                                  data.rationale || data.explanation || '';
                    }

                    // 提取信心指数
                    confidence = data.confidence || data.confidence_level || '';
                    if (typeof confidence === 'number') {
                        confidence = `${(confidence * 100).toFixed(0)}%`;
                    }

                    // 如果有price_target，添加到reasoning
                    if (data.profit_target && data.profit_target > 0) {
                        reasoning += `\n目标价格: $${data.profit_target.toFixed(2)}`;
                    }

                    // 如果有stop_loss，添加到reasoning
                    if (data.stop_loss && data.stop_loss > 0) {
                        reasoning += `\n止损价格: $${data.stop_loss.toFixed(2)}`;
                    }

                    // 如果有leverage，添加到reasoning
                    if (data.leverage && data.leverage > 1) {
                        reasoning += `\n杠杆倍数: ${data.leverage}x`;
                    }
                }
            } catch (e) {
                console.warn('Failed to parse AI response as JSON:', e);
            }

            // 智能文本解析 - 如果JSON解析失败
            if (!parsedData || (parsedData && Object.keys(parsedData).length === 0)) {
                // 尝试从文本中提取信息
                const textAnalysis = this.extractFromText(response);

                if (textAnalysis.signal) {
                    decision = textAnalysis.signal;
                    reasoning = textAnalysis.reasoning;
                    marketAnalysis = textAnalysis.marketAnalysis;
                    confidence = textAnalysis.confidence;
                } else {
                    // 如果完全无法解析，显示原始文本
                    decision = '观望';
                    reasoning = response.length > 500 ? response.substring(0, 500) + '...' : response;
                }
            }

            // 决策类型样式
            let decisionClass = 'decision-hold';
            let decisionIcon = '⏸';
            if (decision.includes('买') || decision.includes('BUY') || decision.includes('buy')) {
                decisionClass = 'decision-buy';
                decisionIcon = '📈';
            } else if (decision.includes('卖') || decision.includes('SELL') || decision.includes('sell')) {
                decisionClass = 'decision-sell';
                decisionIcon = '📉';
            } else if (decision.includes('平') || decision.includes('close')) {
                decisionClass = 'decision-close';
                decisionIcon = '🔄';
            }

            // 构建友好的展示内容
            let displayContent = '';
            if (parsedData && (marketAnalysis || reasoning || confidence)) {
                // 结构化展示
                displayContent = `
                    <div class="ai-analysis-label">
                        <i class="bi bi-robot"></i> AI分析
                    </div>
                    ${marketAnalysis ? `<div class="analysis-section">
                        <div class="section-title"><i class="bi bi-graph-up"></i> 市场分析</div>
                        <div class="section-content">${this.escapeHtml(marketAnalysis)}</div>
                    </div>` : ''}
                    ${reasoning ? `<div class="analysis-section">
                        <div class="section-title"><i class="bi bi-lightbulb"></i> 决策理由</div>
                        <div class="section-content">${this.escapeHtml(reasoning).replace(/\n/g, '<br>')}</div>
                    </div>` : ''}
                    ${confidence ? `<div class="analysis-section">
                        <div class="section-title"><i class="bi bi-speedometer2"></i> 信心指数</div>
                        <div class="section-content"><strong>${confidence}</strong></div>
                    </div>` : ''}
                `;
            } else {
                // 简单文本展示
                displayContent = `
                    <div class="ai-analysis-label">
                        <i class="bi bi-robot"></i> AI分析
                    </div>
                    <div class="analysis-section">
                        <div class="section-content">${this.escapeHtml(reasoning).replace(/\n/g, '<br>')}</div>
                    </div>
                `;
            }

            return `
                <div class="conversation-item">
                    <div class="conversation-header">
                        <div class="conversation-time">
                            <i class="bi bi-clock"></i>
                            ${new Date(conv.timestamp).toLocaleString('zh-CN', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                            })}
                        </div>
                        <div class="conversation-decision ${decisionClass}">
                            ${decisionIcon} ${decision}
                        </div>
                    </div>
                    <div class="conversation-content">
                        ${displayContent}
                    </div>
                </div>
            `;
        }).join('');
    }

    async loadMarketPrices() {
        try {
            const response = await fetch('/api/market/prices');
            const prices = await response.json();
            this.renderMarketPrices(prices);
        } catch (error) {
            console.error('Failed to load market prices:', error);
        }
    }

    renderMarketPrices(prices) {
        const container = document.getElementById('marketPrices');
        
        container.innerHTML = Object.entries(prices).map(([coin, data]) => {
            const changeClass = data.change_24h >= 0 ? 'positive' : 'negative';
            const changeIcon = data.change_24h >= 0 ? '▲' : '▼';
            
            return `
                <div class="price-item">
                    <div>
                        <div class="price-symbol">${coin}</div>
                        <div class="price-change ${changeClass}">${changeIcon} ${Math.abs(data.change_24h).toFixed(2)}%</div>
                    </div>
                    <div class="price-value">$${data.price.toFixed(2)}</div>
                </div>
            `;
        }).join('');
    }

    extractFromText(text) {
        /**
         * 智能从文本中提取交易决策信息
         */
        const result = {
            signal: '',
            reasoning: '',
            marketAnalysis: '',
            confidence: ''
        };

        if (!text || text.trim() === '') {
            return result;
        }

        const textLower = text.toLowerCase();

        // 提取信号
        if (textLower.includes('buy') || textLower.includes('买入') || textLower.includes('做多')) {
            result.signal = '买入';
        } else if (textLower.includes('sell') || textLower.includes('卖出') || textLower.includes('做空')) {
            result.signal = '卖出';
        } else if (textLower.includes('close') || textLower.includes('平仓')) {
            result.signal = '平仓';
        } else if (textLower.includes('hold') || textLower.includes('持有') || textLower.includes('观望')) {
            result.signal = '持有';
        }

        // 提取市场分析
        const marketMatch = text.match(/(?:market|市场|分析)[:\s]+([^\n.]{20,200})/i);
        if (marketMatch) {
            result.marketAnalysis = marketMatch[1].trim();
        }

        // 提取推理
        const reasoningMatch = text.match(/(?:reason|reasoning|理由|原因)[:\s]+([^\n.]{20,300})/i);
        if (reasoningMatch) {
            result.reasoning = reasoningMatch[1].trim();
        } else {
            // 如果没有找到明确的推理，使用前200字符
            result.reasoning = text.substring(0, 200).trim();
        }

        // 提取信心指数
        const confidenceMatch = text.match(/confidence[:\s]+([0-9.]+)/i);
        if (confidenceMatch) {
            let conf = parseFloat(confidenceMatch[1]);
            if (conf > 1) conf = conf / 100;
            result.confidence = `${(conf * 100).toFixed(0)}%`;
        }

        return result;
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}Tab`).classList.add('active');
    }

    showModal() {
        document.getElementById('addModelModal').classList.add('show');
    }

    hideModal() {
        document.getElementById('addModelModal').classList.remove('show');
    }

    async submitModel() {
        const systemPrompt = document.getElementById('systemPrompt').value.trim();

        const data = {
            name: document.getElementById('modelName').value,
            api_key: document.getElementById('apiKey').value,
            api_url: document.getElementById('apiUrl').value,
            model_name: document.getElementById('modelIdentifier').value,
            initial_capital: parseFloat(document.getElementById('initialCapital').value),
            system_prompt: systemPrompt || null  // 如果为空则传null，使用默认prompt
        };

        if (!data.name || !data.api_key || !data.api_url || !data.model_name) {
            alert('请填写所有必填字段');
            return;
        }

        try {
            const response = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                this.hideModal();
                this.loadModels();
                this.clearForm();
            }
        } catch (error) {
            console.error('Failed to add model:', error);
            alert('添加模型失败');
        }
    }

    async editModel(modelId) {
        try {
            // 获取模型详情
            const response = await fetch(`/api/models/${modelId}`);
            if (!response.ok) {
                alert('获取模型信息失败');
                return;
            }

            const model = await response.json();

            // 填充编辑表单
            document.getElementById('editModelId').value = model.id;
            document.getElementById('editModelName').value = model.name;
            document.getElementById('editApiKey').value = '••••••••';  // 不显示真实API Key
            document.getElementById('editApiUrl').value = model.api_url;
            document.getElementById('editModelIdentifier').value = model.model_name;
            document.getElementById('editInitialCapital').value = model.initial_capital;
            document.getElementById('editSystemPrompt').value = model.system_prompt || '';

            // 显示编辑modal
            document.getElementById('editModelModal').classList.add('show');
        } catch (error) {
            console.error('Failed to load model for editing:', error);
            alert('获取模型信息失败');
        }
    }

    async deleteModel(modelId) {
        if (!confirm('确定要删除这个模型吗？')) return;

        try {
            const response = await fetch(`/api/models/${modelId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                if (this.currentModelId === modelId) {
                    this.currentModelId = null;
                }
                this.loadModels();
            }
        } catch (error) {
            console.error('Failed to delete model:', error);
        }
    }

    clearForm() {
        document.getElementById('modelName').value = '';
        document.getElementById('apiKey').value = '';
        document.getElementById('apiUrl').value = '';
        document.getElementById('modelIdentifier').value = '';
        document.getElementById('initialCapital').value = '10000';
        document.getElementById('systemPrompt').value = '';
    }

    async refresh() {
        await Promise.all([
            this.loadModels(),
            this.loadMarketPrices(),
            this.loadModelData()
        ]);
    }

    startRefreshCycles() {
        this.refreshIntervals.market = setInterval(() => {
            this.loadMarketPrices();
        }, 5000);

        this.refreshIntervals.portfolio = setInterval(() => {
            if (this.currentModelId) {
                this.loadModelData();
            }
        }, 10000);
    }

    stopRefreshCycles() {
        Object.values(this.refreshIntervals).forEach(interval => {
            if (interval) clearInterval(interval);
        });
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);

        // 更新图标
        const icon = document.querySelector('#themeToggle i');
        if (newTheme === 'dark') {
            icon.className = 'bi bi-sun-fill';
        } else {
            icon.className = 'bi bi-moon-fill';
        }

        // 重新渲染图表
        if (this.chart) {
            this.chart.dispose();
            this.chart = echarts.init(document.getElementById('accountChart'));
            this.loadModelData();
        }
        if (this.klineChart) {
            this.klineChart.dispose();
            this.klineChart = echarts.init(document.getElementById('klineChart'));
            this.loadKlineData();
        }
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        const icon = document.querySelector('#themeToggle i');
        if (savedTheme === 'dark') {
            icon.className = 'bi bi-sun-fill';
        } else {
            icon.className = 'bi bi-moon-fill';
        }
    }

    getKlineColors() {
        if (this.klineColorMode === 'red-up') {
            // 红涨绿跌（中国大陆）
            return {
                color: '#ef4444',        // 涨：红色（实体）
                color0: '#22c55e',       // 跌：绿色（实体）
                borderColor: '#ef4444',  // 涨：红色（边框和影线）
                borderColor0: '#22c55e', // 跌：绿色（边框和影线）
                borderWidth: 3           // 增加边框宽度，影线更明显
            };
        } else {
            // 绿涨红跌（国际）
            return {
                color: '#22c55e',        // 涨：绿色（实体）
                color0: '#ef4444',       // 跌：红色（实体）
                borderColor: '#22c55e',  // 涨：绿色（边框和影线）
                borderColor0: '#ef4444', // 跌：红色（边框和影线）
                borderWidth: 3           // 增加边框宽度，影线更明显
            };
        }
    }

    toggleKlineColor() {
        this.klineColorMode = this.klineColorMode === 'red-up' ? 'green-up' : 'red-up';
        const btn = document.getElementById('klineColorToggle');
        btn.innerHTML = this.klineColorMode === 'red-up'
            ? '<i class="bi bi-palette"></i> 绿涨红跌'
            : '<i class="bi bi-palette"></i> 红涨绿跌';
        this.loadKlineData(); // 重新加载K线图
    }

    initKlineChart() {
        const chartDom = document.getElementById('klineChart');
        this.klineChart = echarts.init(chartDom);
        this.loadKlineData();
    }

    async loadKlineData() {
        try {
            const response = await fetch(`/api/market/historical/${this.currentKlineCoin}?days=30`);
            const data = await response.json();

            if (!data || data.length === 0) {
                console.warn('No kline data available');
                return;
            }

            // 转换数据格式为ECharts K线图格式
            const klineData = data.map(item => [
                item.timestamp,
                item.open || item.price,
                item.close || item.price,
                item.low || item.price,
                item.high || item.price,
                item.volume || 0
            ]);

            const option = {
                title: {
                    text: `${this.currentKlineCoin}/USDT`,
                    left: 0
                },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: {
                        type: 'cross'
                    }
                },
                legend: {
                    data: ['K线', '成交量'],
                    top: 30
                },
                grid: [
                    {
                        left: '10%',
                        right: '10%',
                        top: '15%',
                        height: '50%'
                    },
                    {
                        left: '10%',
                        right: '10%',
                        top: '70%',
                        height: '15%'
                    }
                ],
                xAxis: [
                    {
                        type: 'category',
                        data: klineData.map(item => new Date(item[0]).toLocaleDateString()),
                        boundaryGap: false,
                        axisLine: { onZero: false },
                        splitLine: { show: false },
                        min: 'dataMin',
                        max: 'dataMax'
                    },
                    {
                        type: 'category',
                        gridIndex: 1,
                        data: klineData.map(item => new Date(item[0]).toLocaleDateString()),
                        boundaryGap: false,
                        axisLine: { onZero: false },
                        axisTick: { show: false },
                        splitLine: { show: false },
                        axisLabel: { show: false },
                        min: 'dataMin',
                        max: 'dataMax'
                    }
                ],
                yAxis: [
                    {
                        scale: true,
                        splitArea: {
                            show: false
                        },
                        splitLine: {
                            show: true,
                            lineStyle: {
                                color: '#e5e6eb',
                                type: 'dashed'
                            }
                        },
                        axisLabel: {
                            fontSize: 12,
                            color: '#86909c'
                        }
                    },
                    {
                        scale: true,
                        gridIndex: 1,
                        splitNumber: 2,
                        axisLabel: { show: false },
                        axisLine: { show: false },
                        axisTick: { show: false },
                        splitLine: { show: false }
                    }
                ],
                dataZoom: [
                    {
                        type: 'inside',
                        xAxisIndex: [0, 1],
                        start: 50,
                        end: 100
                    },
                    {
                        show: true,
                        xAxisIndex: [0, 1],
                        type: 'slider',
                        top: '90%',
                        start: 50,
                        end: 100
                    }
                ],
                series: [
                    {
                        name: 'K线',
                        type: 'candlestick',
                        data: klineData.map(item => [item[1], item[2], item[3], item[4]]),
                        itemStyle: this.getKlineColors(),
                        barWidth: '90%',           // 更粗的蜡烛
                        barMaxWidth: 30,           // 增加最大宽度
                        barMinWidth: 8             // 增加最小宽度
                    },
                    {
                        name: '成交量',
                        type: 'bar',
                        xAxisIndex: 1,
                        yAxisIndex: 1,
                        data: klineData.map((item, idx) => {
                            // 根据涨跌设置成交量颜色
                            const isUp = idx === 0 ? true : item[4] >= klineData[idx-1][4];
                            return {
                                value: item[5],
                                itemStyle: {
                                    color: isUp ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'
                                }
                            };
                        })
                    }
                ]
            };

            this.klineChart.setOption(option);
        } catch (error) {
            console.error('Failed to load kline data:', error);
        }
    }
}

const app = new TradingApp();

// Edit Model Modal事件监听
document.getElementById('closeEditModalBtn').addEventListener('click', () => {
    document.getElementById('editModelModal').classList.remove('show');
});

document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('editModelModal').classList.remove('show');
});

document.getElementById('submitEditBtn').addEventListener('click', async () => {
    const modelId = document.getElementById('editModelId').value;
    const systemPrompt = document.getElementById('editSystemPrompt').value;

    try {
        const response = await fetch(`/api/models/${modelId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system_prompt: systemPrompt
            })
        });

        if (response.ok) {
            document.getElementById('editModelModal').classList.remove('show');
            alert('交易策略更新成功！');
            app.loadModels();
        } else {
            const error = await response.json();
            alert(error.error || '更新失败');
        }
    } catch (error) {
        console.error('Failed to update model:', error);
        alert('更新失败');
    }
});
