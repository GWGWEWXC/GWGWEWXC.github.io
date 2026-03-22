// ========== 配置区域 ==========
const MQTT_CONFIG = {
    brokerUrl: 'wss://broker-cn.emqx.io:8084/mqtt',
    pubTopic: 'dk/cdnu/laboratory/gwww/temp',
    subTopic: 'dk/cdnu/laboratory/gwww/swtich',
    clientId: 'web_' + Math.random().toString(16).substr(2, 8)
};

// 全局变量
let mqttClient = null;
let sensorData = { temp: 0, humi: 0, light: 0, rain: 0, smoke: 0, ir: 0 };
let historyData = { 
    labels: [], 
    temp: [], humi: [], 
    light: [], rain: [], smoke: [] 
};
const MAX_HISTORY = 60; 
let charts = {};

// ========== 初始化 ==========
window.addEventListener('DOMContentLoaded', () => {
    initCharts();
    connectMQTT();
    
    document.getElementById('motorOn')?.addEventListener('click', () => sendCommand('true'));
    document.getElementById('motorOff')?.addEventListener('click', () => sendCommand('false'));
});

// ========== MQTT 逻辑 ==========
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

// ========== 界面更新 ==========
function updateDashboard() {
    const el = (id) => document.getElementById(id);
    if (el('tempValue')) el('tempValue').textContent = sensorData.temp + ' °C';
    if (el('humiValue')) el('humiValue').textContent = sensorData.humi + ' %';
    if (el('lightValue')) el('lightValue').textContent = sensorData.light;
    if (el('rainValue')) el('rainValue').textContent = sensorData.rain;
    if (el('smokeValue')) el('smokeValue').textContent = sensorData.smoke;

    // ✅ 修复：添加 data: 关键字
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

// ========== ECharts 配置 ==========
function initCharts() {
    // ✅ 修复：确保 DOM 元素存在
    const ids = ['tempGauge','humiGauge','lightGauge','rainGauge','smokeGauge',
                 'tempHumiChart','sensorChart'];
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

    const gaugeOpt = (title, max, color) => ({
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

    charts.tempGauge.setOption(gaugeOpt('温度', 100, '#37a2da'));
    charts.humiGauge.setOption(gaugeOpt('湿度', 100, '#67e0e3'));
    charts.lightGauge.setOption(gaugeOpt('光强', 4100, '#ffdb5c'));
    charts.rainGauge.setOption(gaugeOpt('雨滴', 4100, '#9fe6b8'));
    charts.smokeGauge.setOption(gaugeOpt('烟雾', 4100, '#edafda'));

    charts.tempHumiChart = echarts.init(document.getElementById('tempHumiChart'));
    charts.sensorChart = echarts.init(document.getElementById('sensorChart'));
    
    updateCharts();

    window.addEventListener('resize', () => {
        Object.values(charts).forEach(c => c?.resize());
    });
}

function updateCharts() {
    // ✅ 修复：确保数据数组不为空
    const labels = historyData.labels.length > 0 ? historyData.labels : ['--'];
    
    // 温湿度图
    charts.tempHumiChart?.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['温度', '湿度'], top: 10 },
        grid: { left: '3%', right: '4%', bottom: '3%', top: 50, containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: labels },
        yAxis: { type: 'value', min: 0, max: 100, name: '数值' },
        series: [
            { 
                name: '温度', 
                type: 'line', 
                smooth: true, 
                data: historyData.temp.length > 0 ? historyData.temp : [0],
                itemStyle: { color: '#37a2da' } 
            },
            { 
                name: '湿度', 
                type: 'line', 
                smooth: true, 
                data: historyData.humi.length > 0 ? historyData.humi : [0],
                itemStyle: { color: '#67e0e3' } 
            }
        ]
    });

    // 传感器图
    charts.sensorChart?.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['光照', '雨滴', '烟雾'], top: 10 },
        grid: { left: '3%', right: '4%', bottom: '3%', top: 50, containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: labels },
        yAxis: { type: 'value', min: 0, max: 4100, name: '数值' },
        series: [
            { 
                name: '光照', 
                type: 'line', 
                smooth: true, 
                data: historyData.light.length > 0 ? historyData.light : [0],
                itemStyle: { color: '#ffdb5c' } 
            },
            { 
                name: '雨滴', 
                type: 'line', 
                smooth: true, 
                data: historyData.rain.length > 0 ? historyData.rain : [0],
                itemStyle: { color: '#9fe6b8' } 
            },
            { 
                name: '烟雾', 
                type: 'line', 
                smooth: true, 
                data: historyData.smoke.length > 0 ? historyData.smoke : [0],
                itemStyle: { color: '#edafda' } 
            }
        ]
    });
}
