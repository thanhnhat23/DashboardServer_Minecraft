// charts.js - Chart.js setup for real-time CPU/RAM
let statsChart;
let cpuHistory = [];
let memHistory = [];
let timeHistory = [];

// Maximum data points in chart
const MAX_POINTS = 60; // ~1 minute at 1 update per second

const statsData = {
    labels: [],
    datasets: [
        {
            label: 'CPU Usage (%)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            yAxisID: 'y',
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2
        },
        {
            label: 'RAM Usage (%)',
            data: [],
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168,85,247,0.1)',
            yAxisID: 'y1',
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2
        }
    ]
};

function initStatsChart() {
    const ctx = document.getElementById('statsChart').getContext('2d');
    statsChart = new Chart(ctx, {
        type: 'line',
        data: statsData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            stacked: false,
            plugins: {
                legend: { 
                    labels: { 
                        color: '#f1f5f9',
                        font: { size: 12 },
                        usePointStyle: true,
                        padding: 20
                    },
                    position: 'top'
                },
                filler: { propagate: true },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 12,
                    titleColor: '#f1f5f9',
                    bodyColor: '#cbd5e1',
                    borderColor: '#374151',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(1) + '%';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: { 
                        color: '#9ca3af',
                        maxRotation: 0,
                        autoSkipPadding: 15
                    },
                    grid: { 
                        color: 'rgba(99,102,241,0.1)',
                        drawBorder: false
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'CPU %', color: '#3b82f6' },
                    ticks: { 
                        color: '#9ca3af',
                        callback: function(value) { return value + '%'; }
                    },
                    grid: { 
                        color: 'rgba(59,130,246,0.1)',
                        drawBorder: false
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: 100,
                    title: { display: true, text: 'RAM %', color: '#a855f7' },
                    ticks: { 
                        color: '#9ca3af',
                        callback: function(value) { return value + '%'; }
                    },
                    grid: { 
                        drawOnChartArea: false,
                        drawBorder: false
                    }
                }
            }
        }
    });
}

// Add new data point to chart
function addStatsPoint(cpu, mem) {
    if (!statsChart) return;
    
    // Add data
    cpuHistory.push(cpu || 0);
    memHistory.push(mem || 0);
    
    // Time label
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    timeHistory.push(timeStr);
    
    // Keep only last MAX_POINTS
    if (cpuHistory.length > MAX_POINTS) {
        cpuHistory.shift();
        memHistory.shift();
        timeHistory.shift();
    }
    
    // Update chart
    statsData.labels = timeHistory;
    statsData.datasets[0].data = cpuHistory;
    statsData.datasets[1].data = memHistory;
    
    // Use 'none' mode for instant updates without animation
    statsChart.update('none');
}

// Clear chart
function clearStatsChart() {
    cpuHistory = [];
    memHistory = [];
    timeHistory = [];
    if (statsChart) {
        statsData.labels = [];
        statsData.datasets[0].data = [];
        statsData.datasets[1].data = [];
        statsChart.update();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    initStatsChart();
});
