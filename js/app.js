// ========== 配置区域 ==========
const MQTT_CONFIG = {
    brokerUrl: 'wss://broker-cn.emqx.io:8084/mqtt',
    pubTopic: 'dk/cdnu/laboratory/gwww/temp',
    subTopic: 'dk/cdnu/laboratory/gwww/swtich',
    clientId: 'web_' + Math.random().toString(16).substr(2, 8)
};

const AI_CONFIG = {
    enabled: true,
    autoAnalyze: true,
    analyzeInterval: 10 * 60 * 1000,
    backendUrl: 'http://localhost:3000/api'
};

// ========== 全局变量 ==========
let mqttClient = null;
let sensorData = { temp: 0, humi: 0, light: 0, rain: 0, smoke: 0, ir: 0 };
let historyData = { labels: [], temp: [], humi: [], light: [], rain: [], smoke: [] };
const MAX_HISTORY = 60; 
let charts = {};
let aiAnalysisResult = null;
let lastAnalyzeTime = 0;

// ✅ 语音交互变量
let audioStream = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentResponseText = '';

// ========== 初始化（合并所有初始化） ==========
window.addEventListener('DOMContentLoaded', () => {
    initCharts();
    connectMQTT();
    initAI();
    initHealthReport();
    initVoiceInteraction();  // ✅ 添加语音初始化
    
    document.getElementById('motorOn')?.addEventListener('click', () => sendCommand('true'));
    document.getElementById('motorOff')?.addEventListener('click', () => sendCommand('false'));
    document.getElementById('aiRefresh')?.addEventListener('click', () => triggerAIAnalysis(true));
});

// ========== AI 初始化 ==========
function initAI() {
    console.log('🤖 AI 模块初始化');
    if (AI_CONFIG.enabled && AI_CONFIG.autoAnalyze) {
        setInterval(() => {
            triggerAIAnalysis(false);
        }, AI_CONFIG.analyzeInterval);
    }
}

// ========== MQTT 连接 ==========
function connectMQTT() {
    console.log('正在连接 MQTT...', MQTT_CONFIG.brokerUrl);
    
    try {
        mqttClient = mqtt.connect(MQTT_CONFIG.brokerUrl, {
            clientId: MQTT_CONFIG.clientId,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 1000
        });

        mqttClient.on('connect', () => {
            console.log('✅ MQTT 连接成功');
            updateStatus(true);
            mqttClient.subscribe(MQTT_CONFIG.pubTopic, (err) => {
                if (!err) console.log('📥 已订阅:', MQTT_CONFIG.pubTopic);
            });
        });

        mqttClient.on('message', (topic, message) => {
            handleMqttMessage(message.toString());
        });

        mqttClient.on('error', (err) => {
            console.error('❌ MQTT 错误:', err);
            updateStatus(false);
        });
        
        mqttClient.on('close', () => {
            console.log('MQTT 连接关闭');
            updateStatus(false);
        });

    } catch (e) {
        console.error('连接失败:', e);
    }
}

// ========== 处理 MQTT 消息 ==========
function handleMqttMessage(payload) {
    try {
        let data;
        if (payload.trim().startsWith('{')) {
            data = JSON.parse(payload);
        } else {
            data = parseLegacyFormat(payload);
        }

        if (data.T !== undefined) sensorData.temp = data.T;
        if (data.H !== undefined) sensorData.humi = data.H;
        if (data.L !== undefined) sensorData.light = data.L;
        if (data.W !== undefined) sensorData.rain = data.W;
        if (data.F !== undefined) sensorData.smoke = data.F;
        if (data.R !== undefined) sensorData.ir = data.R;

        updateDashboard();
        addToHistory();
        updateCharts();
        checkAutoAnalyze();

    } catch (e) {
        console.error('解析失败:', e, payload);
    }
}

function parseLegacyFormat(str) {
    const obj = {};
    const parts = str.split(';');
    parts.forEach(p => {
        const kv = p.split(/[:=]/);
        if (kv[0] === 'T') obj.T = parseInt(kv[1]) || 0;
        if (kv[0] === 'H') obj.H = parseInt(kv[1]) || 0;
        if (kv[0] === 'L') obj.L = parseInt(kv[1]) || 0;
        if (kv[0] === 'W') obj.W = parseInt(kv[1]) || 0;
        if (kv[0] === 'R') obj.R = parseInt(kv[1]) || 0;
        if (kv[0] === 'F') obj.F = parseInt(kv[1]) || 0;
    });
    return obj;
}

// ========== 发送控制命令 ==========
function sendCommand(cmd) {
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(MQTT_CONFIG.subTopic, cmd);
        const statusEl = document.getElementById('motorStatus');
        if (statusEl) {
            statusEl.textContent = cmd === 'true' ? '状态：已开启' : '状态：已关闭';
            statusEl.style.background = cmd === 'true' ? '#28a745' : '#dc3545';
            statusEl.style.color = 'white';
        }
        console.log('📤 发送命令:', cmd);
    } else {
        alert('MQTT 未连接，无法控制！');
    }
}

// ========== 更新仪表盘 ==========
function updateDashboard() {
    const el = (id) => document.getElementById(id);
    if (el('tempValue')) el('tempValue').textContent = sensorData.temp + ' °C';
    if (el('humiValue')) el('humiValue').textContent = sensorData.humi + ' %';
    if (el('lightValue')) el('lightValue').textContent = sensorData.light;
    if (el('rainValue')) el('rainValue').textContent = sensorData.rain;
    if (el('smokeValue')) el('smokeValue').textContent = sensorData.smoke;

    if (charts.tempGauge) charts.tempGauge.setOption({ 
        series: [{ data: [{ value: sensorData.temp, name: '温度' }] }] 
    });
    if (charts.humiGauge) charts.humiGauge.setOption({ 
        series: [{ data: [{ value: sensorData.humi, name: '湿度' }] }] 
    });
    if (charts.lightGauge) charts.lightGauge.setOption({ 
        series: [{ data: [{ value: sensorData.light, name: '光强' }] }] 
    });
    if (charts.rainGauge) charts.rainGauge.setOption({ 
        series: [{ data: [{ value: sensorData.rain, name: '雨滴' }] }] 
    });
    if (charts.smokeGauge) charts.smokeGauge.setOption({ 
        series: [{ data: [{ value: sensorData.smoke, name: '烟雾' }] }] 
    });
}

// ========== 添加到历史记录 ==========
function addToHistory() {
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2,'0') + ':' + 
                    now.getMinutes().toString().padStart(2,'0');
    
    historyData.labels.push(timeStr);
    historyData.temp.push(sensorData.temp);
    historyData.humi.push(sensorData.humi);
    historyData.light.push(sensorData.light);
    historyData.rain.push(sensorData.rain);
    historyData.smoke.push(sensorData.smoke);

    if (historyData.labels.length > MAX_HISTORY) {
        historyData.labels.shift();
        historyData.temp.shift();
        historyData.humi.shift();
        historyData.light.shift();
        historyData.rain.shift();
        historyData.smoke.shift();
    }
}

// ========== 更新连接状态 ==========
function updateStatus(connected) {
    const el = document.getElementById('statusIndicator');
    if (el) {
        if (connected) {
            el.textContent = '已连接';
            el.className = 'indicator connected';
        } else {
            el.textContent = '未连接/重连中...';
            el.className = 'indicator disconnected';
        }
    }
}

// ========== 初始化图表 ==========
function initCharts() {
    const ids = ['tempGauge','humiGauge','lightGauge','rainGauge','smokeGauge',
                 'tempHumiChart','sensorChart','trendChart'];
    ids.forEach(id => {
        if (!document.getElementById(id)) {
            console.warn('⚠️ 缺少元素:', id);
        }
    });

    charts.tempGauge = echarts.init(document.getElementById('tempGauge'));
    charts.humiGauge = echarts.init(document.getElementById('humiGauge'));
    charts.lightGauge = echarts.init(document.getElementById('lightGauge'));
    charts.rainGauge = echarts.init(document.getElementById('rainGauge'));
    charts.smokeGauge = echarts.init(document.getElementById('smokeGauge'));

    const gaugeOpt = (title, max) => ({
        series: [{
            type: 'gauge',
            min: 0,
            max: max,
            radius: '90%',
            startAngle: 200,
            endAngle: -20,
            pointer: { show: true, length: '70%' },
            axisLine: {
                lineStyle: {
                    width: 15,
                    color: [[0.3, '#67e0e3'], [0.7, '#37a2da'], [1, '#fd666d']]
                }
            },
            detail: {
                valueAnimation: true,
                fontSize: 20,
                offsetCenter: [0, '30%'],
                formatter: (value) => value + (title==='温度'?' °C':title==='湿度'?' %':'')
            },
            data: [{ value: 0, name: title }]
        }]
    });

    charts.tempGauge.setOption(gaugeOpt('温度', 100));
    charts.humiGauge.setOption(gaugeOpt('湿度', 100));
    charts.lightGauge.setOption(gaugeOpt('光强', 4100));
    charts.rainGauge.setOption(gaugeOpt('雨滴', 4100));
    charts.smokeGauge.setOption(gaugeOpt('烟雾', 4100));

    charts.tempHumiChart = echarts.init(document.getElementById('tempHumiChart'));
    charts.sensorChart = echarts.init(document.getElementById('sensorChart'));
    
    updateCharts();

    window.addEventListener('resize', () => {
        Object.values(charts).forEach(c => c?.resize());
    });
}

// ========== 更新图表 ==========
function updateCharts() {
    const labels = historyData.labels.length > 0 ? historyData.labels : ['--'];
    
    charts.tempHumiChart?.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['温度', '湿度'], top: 10 },
        grid: { left: '3%', right: '4%', bottom: '3%', top: 50, containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: labels },
        yAxis: { type: 'value', min: 0, max: 100, name: '数值' },
        series: [
            { name: '温度', type: 'line', smooth: true, 
              data: historyData.temp.length > 0 ? historyData.temp : [0],
              itemStyle: { color: '#37a2da' } },
            { name: '湿度', type: 'line', smooth: true, 
              data: historyData.humi.length > 0 ? historyData.humi : [0],
              itemStyle: { color: '#67e0e3' } }
        ]
    });

    charts.sensorChart?.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['光照', '雨滴', '烟雾'], top: 10 },
        grid: { left: '3%', right: '4%', bottom: '3%', top: 50, containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: labels },
        yAxis: { type: 'value', min: 0, max: 4100, name: '数值' },
        series: [
            { name: '光照', type: 'line', smooth: true, 
              data: historyData.light.length > 0 ? historyData.light : [0],
              itemStyle: { color: '#ffdb5c' } },
            { name: '雨滴', type: 'line', smooth: true, 
              data: historyData.rain.length > 0 ? historyData.rain : [0],
              itemStyle: { color: '#9fe6b8' } },
            { name: '烟雾', type: 'line', smooth: true, 
              data: historyData.smoke.length > 0 ? historyData.smoke : [0],
              itemStyle: { color: '#edafda' } }
        ]
    });
}

// ========== AI 分析功能 ==========
function checkAutoAnalyze() {
    if (!AI_CONFIG.enabled || !AI_CONFIG.autoAnalyze) return;
    const now = Date.now();
    if (now - lastAnalyzeTime >= AI_CONFIG.analyzeInterval) {
        triggerAIAnalysis(false);
    }
}

async function triggerAIAnalysis(manual = false) {
    if (!AI_CONFIG.enabled) {
        console.log('AI 功能未启用');
        return;
    }
    
    if (manual) showAILoading();
    
    try {
        const analysisData = {
            current: sensorData,
            history: historyData.labels.slice(-12).map((label, i) => ({
                time: label,
                temp: historyData.temp[i] || 0,
                humi: historyData.humi[i] || 0
            })),
            timestamp: new Date().toISOString()
        };
        
        const response = await fetch(`${AI_CONFIG.backendUrl}/sensor/ai-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(analysisData),
            timeout: 15000
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        
        if (result.success && result.ai) {
            aiAnalysisResult = result.ai;
            lastAnalyzeTime = Date.now();
            showAIAnalysis(result.ai);
        } else {
            throw new Error(result.message || '分析失败');
        }
        
    } catch (error) {
        console.error('❌ AI 分析失败:', error);
        if (manual) showAIError(error.message);
        const fallbackResult = fallbackAIAnalysis();
        aiAnalysisResult = fallbackResult;
        showAIAnalysis(fallbackResult);
    }
}

function showAILoading() {
    const card = document.getElementById('aiAnalysisCard');
    const content = card.querySelector('.ai-content');
    card.style.display = 'block';
    content.innerHTML = '<div class="ai-loading">AI 正在分析</div>';
    document.getElementById('aiStatusDot').className = 'status-dot';
    document.getElementById('aiStatusText').textContent = '分析中...';
}

function showAIAnalysis(ai) {
    const card = document.getElementById('aiAnalysisCard');
    card.style.display = 'block';
    
    const dot = document.getElementById('aiStatusDot');
    const statusText = document.getElementById('aiStatusText');
    dot.className = `status-dot ${ai.status || 'normal'}`;
    statusText.textContent = ai.summary || '分析完成';
    
    document.getElementById('aiSummary').textContent = ai.summary || '环境正常';
    document.getElementById('aiAnalysis').textContent = ai.analysis || '暂无详细分析';
    
    const suggestionList = document.getElementById('aiSuggestionList');
    if (ai.suggestions && ai.suggestions.length > 0) {
        suggestionList.innerHTML = ai.suggestions.map(s => `<li>${s}</li>`).join('');
    } else {
        suggestionList.innerHTML = '<li>继续监测，保持当前状态</li>';
    }
    
    const riskDiv = document.getElementById('aiRiskLevel');
    if (ai.riskLevel) {
        riskDiv.style.display = 'block';
        riskDiv.className = `ai-risk ${ai.riskLevel.toLowerCase()}`;
        document.getElementById('aiRiskText').textContent = ai.riskLevel;
    } else {
        riskDiv.style.display = 'none';
    }
}

function showAIError(message) {
    const card = document.getElementById('aiAnalysisCard');
    card.style.display = 'block';
    document.getElementById('aiStatusDot').className = 'status-dot critical';
    document.getElementById('aiStatusText').textContent = '分析失败';
    document.getElementById('aiSummary').textContent = '⚠️ AI 服务暂时不可用';
    document.getElementById('aiAnalysis').textContent = message || '请稍后重试';
    document.getElementById('aiSuggestionList').innerHTML = '<li>使用本地规则进行分析</li>';
}

function fallbackAIAnalysis() {
    let status = 'normal', suggestions = [], riskLevel = '低', summary = '环境正常';
    
    if (sensorData.temp > 35 || sensorData.temp < 10) {
        status = 'critical'; riskLevel = '高';
        suggestions.push('温度异常，立即确认老人安全');
        summary = '⚠️ 温度异常警告';
    } else if (sensorData.temp > 30 || sensorData.temp < 15) {
        status = 'warning'; riskLevel = '中';
        suggestions.push('温度偏高/低，建议调节室内环境');
    }
    
    if (sensorData.humi > 85 || sensorData.humi < 30) {
        if (status !== 'critical') { status = 'warning'; riskLevel = '中'; }
        suggestions.push('湿度异常，注意防潮或加湿');
    }
    
    if (sensorData.smoke > 2500) {
        status = 'critical'; riskLevel = '高';
        suggestions.push('检测到烟雾，检查是否用火安全');
        summary = '🔥 烟雾警告！';
    }
    
    if (suggestions.length === 0) suggestions.push('环境良好，继续保持');
    
    return { status, summary, analysis: `温度${sensorData.temp}°C，湿度${sensorData.humi}%`, suggestions, riskLevel, notifyFamily: status === 'critical' };
}

// ========== 健康报告功能 ==========
async function generateHealthReport(type = 'daily') {
    const loadingEl = document.getElementById('reportLoading');
    const contentEl = document.getElementById('reportContent');
    const cardEl = document.getElementById('healthReportCard');
    
    cardEl.style.display = 'block';
    loadingEl.style.display = 'block';
    contentEl.innerHTML = '';
    
    try {
        const hours = type === 'daily' ? 24 : 168;
        const response = await fetch(`${AI_CONFIG.backendUrl}/health/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, hours })
        });
        
        const result = await response.json();
        
        if (result.success && result.report) {
            displayHealthReport(result.report);
        } else {
            contentEl.innerHTML = `<p class="error">生成报告失败：${result.message}</p>`;
        }
    } catch (error) {
        console.error('生成报告失败:', error);
        contentEl.innerHTML = '<p class="error">网络错误，请稍后重试</p>';
    } finally {
        loadingEl.style.display = 'none';
    }
}

function displayHealthReport(report) {
    const contentEl = document.getElementById('reportContent');
    
    const html = `
        <div class="report-section">
            <h4>📋 ${report.reportTitle}</h4>
            <div class="report-summary">
                <strong>整体状况：</strong><span>${report.overallStatus}</span><br>
                ${report.summary}
            </div>
        </div>
        <div class="report-section">
            <h4>📈 趋势分析</h4>
            <div class="trend-item"><strong>温度：</strong>${report.trends.temperature}</div>
            <div class="trend-item"><strong>湿度：</strong>${report.trends.humidity}</div>
            <div class="trend-item"><strong>活动：</strong>${report.trends.activity}</div>
        </div>
        <div class="report-section">
            <h4>⚠️ 风险预测</h4>
            <div class="risk-grid">
                ${Object.entries(report.riskPrediction).map(([key, value]) => {
                    if (key === '分析') return '';
                    const riskClass = value.includes('低') ? 'low' : value.includes('中') ? 'medium' : 'high';
                    return `<div class="risk-item"><div class="risk-label">${key}</div><div class="risk-value ${riskClass}">${value}</div></div>`;
                }).join('')}
            </div>
        </div>
        <div class="report-section">
            <h4>💡 个性化建议</h4>
            <ul class="advice-list">
                ${report.personalizedAdvice.map(advice => `<li>${advice}</li>`).join('')}
            </ul>
        </div>
    `;
    contentEl.innerHTML = html;
}

async function loadTrendData(hours = 24) {
    try {
        const response = await fetch(`${AI_CONFIG.backendUrl}/health/trends?hours=${hours}`);
        const result = await response.json();
        
        if (result.success && result.trends) {
            displayTrendChart(result.trends);
        }
    } catch (error) {
        console.error('加载趋势数据失败:', error);
    }
}

function displayTrendChart(trends) {
    if (!charts.trendChart) {
        charts.trendChart = echarts.init(document.getElementById('trendChart'));
    }
    
    const option = {
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { data: ['温度', '湿度', '光照'], top: 10 },
        grid: { left: '3%', right: '4%', bottom: '3%', top: 60, containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: trends.labels },
        yAxis: [
            { type: 'value', name: '温度 (°C)', position: 'left', min: 0, max: 50 },
            { type: 'value', name: '湿度 (%)', position: 'right', min: 0, max: 100 }
        ],
        series: [
            {
                name: '温度',
                type: 'line',
                smooth: true,
                data: trends.temp,
                itemStyle: { color: '#37a2da' },
                markPoint: { data: [{ type: 'max', name: '最高' }, { type: 'min', name: '最低' }] }
            },
            {
                name: '湿度',
                type: 'line',
                smooth: true,
                yAxisIndex: 1,
                data: trends.humi,
                itemStyle: { color: '#67e0e3' }
            },
            {
                name: '光照',
                type: 'bar',
                data: trends.light,
                itemStyle: { color: '#ffdb5c' },
                opacity: 0.6
            }
        ]
    };
    
    charts.trendChart.setOption(option);
    charts.trendChart.resize();
}

function initHealthReport() {
    console.log('📊 健康报告模块初始化');
    document.getElementById('generateReport')?.addEventListener('click', () => {
        const type = document.getElementById('reportType').value;
        generateHealthReport(type);
    });
    generateHealthReport('daily');
    loadTrendData(24);
}

// ========== 语音交互功能 ==========
async function initVoiceInteraction() {
    const voiceBtn = document.getElementById('voiceBtn');
    const playBtn = document.getElementById('playResponse');
    
    if (!voiceBtn) return;
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('您的浏览器不支持语音录制功能，请使用 Chrome 或 Edge 浏览器');
        return;
    }
    
    // ✅ 页面加载时一次性获取麦克风权限
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            } 
        });
        console.log('✅ 麦克风权限已获取');
    } catch (error) {
        console.error('获取麦克风权限失败:', error);
        alert('无法获取麦克风权限，请检查浏览器设置');
        return;
    }
    
    // 绑定事件
    voiceBtn.addEventListener('mousedown', startRecording);
    voiceBtn.addEventListener('mouseup', stopRecording);
    voiceBtn.addEventListener('mouseleave', () => {
        if (isRecording) stopRecording();
    });
    
    voiceBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startRecording();
    });
    
    voiceBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopRecording();
    });
    
    if (playBtn) {
        playBtn.addEventListener('click', speakResponse);
    }
}

// 在 startRecording 中添加音量检测
async function startRecording() {
    if (isRecording || !audioStream) return;
    
    try {
        // 创建音频分析器
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(audioStream);
        
        analyser.fftSize = 256;
        microphone.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let hasSpeech = false;
        
        // 实时检测音量
        const checkVolume = () => {
            if (!isRecording) return;
            
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const percentage = Math.round((average / 255) * 100);
            
            const voiceStatus = document.getElementById('voiceStatus');
            
            if (percentage > 15) {
                hasSpeech = true;
                voiceStatus.textContent = `🎤 检测到声音 (${percentage}%)...`;
                voiceStatus.style.background = 'rgba(74, 222, 128, 0.3)';
            } else {
                voiceStatus.textContent = '⏳ 等待说话...';
                voiceStatus.style.background = 'rgba(255, 255, 255, 0.1)';
            }
            
            setTimeout(checkVolume, 100);
        };
        
        checkVolume();
        
        // 3秒后检查是否有语音
        setTimeout(() => {
            if (!hasSpeech) {
                console.warn('⚠️ 3秒内未检测到有效语音');
                document.getElementById('voiceStatus').textContent = '⚠️ 未检测到语音，请大声说话';
            }
        }, 3000);
        
        // 创建 MediaRecorder
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus'
        ];
        
        let selectedMimeType = '';
        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                selectedMimeType = mimeType;
                break;
            }
        }
        
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: selectedMimeType || 'audio/webm',
            audioBitsPerSecond: 128000
        });
        
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: selectedMimeType || 'audio/webm' });
            await processVoice(audioBlob);
        };
        
        mediaRecorder.start(100);
        isRecording = true;
        
        const voiceBtn = document.getElementById('voiceBtn');
        voiceBtn.classList.add('recording');
        
    } catch (error) {
        console.error('❌ 录音失败:', error);
        alert('录音失败，请重试');
    }
}

function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    
    mediaRecorder.stop();
    isRecording = false;
    
    const voiceBtn = document.getElementById('voiceBtn');
    const voiceStatus = document.getElementById('voiceStatus');
    voiceBtn.classList.remove('recording');
    voiceStatus.textContent = '处理中...';
}

// ✅ 正确的实现
// ========== 语音识别处理函数 ==========
async function processVoice(audioBlob) {
    try {
        // 检查浏览器是否支持语音识别
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.error('❌ 浏览器不支持语音识别');
            alert('您的浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器');
            document.getElementById('voiceStatus').textContent = '❌ 浏览器不支持';
            return;
        }
        
        // 创建语音识别实例
        const recognition = new SpeechRecognition();
        
        // ✅ 配置识别参数
        recognition.lang = 'zh-CN';              // 中文（简体）
        recognition.continuous = false;           // 单次识别（说完自动停止）
        recognition.interimResults = false;       // 只要最终结果
        recognition.maxAlternatives = 3;          // 返回3个备选结果
        
        // ✅ 识别开始事件
        recognition.onstart = () => {
            console.log('🎤 语音识别已开始');
            const voiceStatus = document.getElementById('voiceStatus');
            voiceStatus.textContent = '🎤 请说话...（3秒内）';
            voiceStatus.style.background = 'rgba(239, 68, 68, 0.3)';
            
            // 3秒后自动停止（避免长时间等待）
            setTimeout(() => {
                try {
                    if (recognition) {
                        console.log('⏱️ 3秒超时，自动停止识别');
                        recognition.stop();
                    }
                } catch (e) {
                    console.error('停止识别失败:', e);
                }
            }, 3000);
        };
        
        // ✅ 识别结果事件
        recognition.onresult = async (event) => {
            console.log('📝 识别结果:', event);
            
            // 获取所有备选结果
            const alternatives = [];
            for (let i = 0; i < event.results[0].length; i++) {
                alternatives.push({
                    text: event.results[0][i].transcript,
                    confidence: event.results[0][i].confidence
                });
            }
            
            console.log('备选结果:', alternatives);
            
            // 选择置信度最高的结果
            let bestResult = alternatives[0];
            for (const alt of alternatives) {
                if (alt.confidence > bestResult.confidence) {
                    bestResult = alt;
                }
            }
            
            const userText = bestResult.text.trim();
            const confidence = Math.round(bestResult.confidence * 100);
            
            console.log(`✅ 最佳结果: "${userText}" (置信度: ${confidence}%)`);
            
            const voiceStatus = document.getElementById('voiceStatus');
            
            // 检查是否有有效内容
            if (userText.length > 0) {
                voiceStatus.textContent = `✅ 识别成功 (${confidence}%): ${userText}`;
                voiceStatus.style.background = 'rgba(74, 222, 128, 0.3)';
                
                // 调用对话处理函数
                await handleChat(userText);
            } else {
                voiceStatus.textContent = '⚠️ 未识别到有效内容，请重试';
                voiceStatus.style.background = 'rgba(251, 191, 36, 0.3)';
            }
        };
        
        // ✅ 识别错误事件
        recognition.onerror = (event) => {
            console.error('❌ 语音识别错误:', event.error);
            
            const voiceStatus = document.getElementById('voiceStatus');
            voiceStatus.style.background = 'rgba(239, 68, 68, 0.3)';
            
            // 根据错误类型给出具体提示
            switch(event.error) {
                case 'no-speech':
                    voiceStatus.textContent = '🔇 未检测到语音，请：\n1. 靠近麦克风 (10cm)\n2. 大声清晰说话\n3. 检查麦克风权限';
                    console.warn('⚠️ 可能原因：麦克风音量太小、距离太远、环境太嘈杂');
                    break;
                    
                case 'audio-capture':
                    voiceStatus.textContent = '🎤 未找到麦克风，请检查连接';
                    console.error('❌ 麦克风设备未找到');
                    break;
                    
                case 'not-allowed':
                    voiceStatus.textContent = '🔒 麦克风权限被拒绝，请在浏览器设置中允许';
                    console.error('❌ 用户拒绝了麦克风权限');
                    break;
                    
                case 'aborted':
                    voiceStatus.textContent = '⏹️ 识别被中止，请重试';
                    console.log('ℹ️ 识别被中止');
                    break;
                    
                case 'network':
                    voiceStatus.textContent = '🌐 网络错误，请检查网络连接';
                    console.error('❌ 网络连接失败');
                    break;
                    
                case 'no-match':
                    voiceStatus.textContent = '❓ 无法识别语音，请重试';
                    console.warn('⚠️ 无法匹配语音');
                    break;
                    
                case 'speech-service-not-available':
                    voiceStatus.textContent = '⚠️ 语音服务不可用，请检查网络';
                    console.error('❌ 语音识别服务不可用');
                    break;
                    
                default:
                    voiceStatus.textContent = `❌ 识别失败：${event.error}，请重试`;
                    console.error('❌ 未知错误:', event.error);
            }
        };
        
        // ✅ 识别结束事件
        recognition.onend = () => {
            console.log('🏁 语音识别结束');
            const voiceStatus = document.getElementById('voiceStatus');
            if (voiceStatus.textContent.includes('识别')) {
                // 如果还在识别状态，恢复为准备就绪
                setTimeout(() => {
                    voiceStatus.textContent = '准备就绪';
                    voiceStatus.style.background = 'rgba(255, 255, 255, 0.1)';
                }, 2000);
            }
        };
        
        // ✅ 延迟启动识别（确保音频上下文就绪）
        setTimeout(() => {
            try {
                recognition.start();
                console.log('✅ recognition.start() 已调用');
            } catch (e) {
                console.error('❌ 启动识别失败:', e);
                document.getElementById('voiceStatus').textContent = '❌ 启动失败，请刷新页面';
            }
        }, 300);
        
    } catch (error) {
        console.error('❌ 语音处理失败:', error);
        const voiceStatus = document.getElementById('voiceStatus');
        voiceStatus.textContent = '❌ 处理失败，请重试';
        voiceStatus.style.background = 'rgba(239, 68, 68, 0.3)';
        
        // 提供备选方案
        setTimeout(() => {
            const userText = prompt('语音识别失败，请手动输入：');
            if (userText && userText.trim()) {
                handleChat(userText.trim());
            }
        }, 1000);
    }
}

async function handleChat(userText) {
    try {
        const response = await fetch(`${AI_CONFIG.backendUrl}/voice/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: userText })
        });
        
        const data = await response.json();
        
        if (data.success) {
            displayResponse(data.text);
        } else {
            throw new Error(data.message || '对话失败');
        }
        
    } catch (error) {
        console.error('对话失败:', error);
        document.getElementById('voiceStatus').textContent = '对话失败，请重试';
    }
}

function displayResponse(text) {
    const responseDiv = document.getElementById('voiceResponse');
    const contentDiv = document.getElementById('responseContent');
    const voiceStatus = document.getElementById('voiceStatus');
    
    responseDiv.style.display = 'block';
    contentDiv.textContent = text;
    currentResponseText = text;
    voiceStatus.textContent = '回复已生成，点击播放';
}

function speakResponse() {
    if (!currentResponseText) return;
    
    const utterance = new SpeechSynthesisUtterance(currentResponseText);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    
    const voiceStatus = document.getElementById('voiceStatus');
    voiceStatus.textContent = '正在播放...';
    
    utterance.onend = () => {
        voiceStatus.textContent = '准备就绪';
    };
    
    utterance.onerror = () => {
        voiceStatus.textContent = '播放失败';
    };
    
    speechSynthesis.speak(utterance);
}

// 页面卸载时关闭媒体流
window.addEventListener('beforeunload', () => {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
});
