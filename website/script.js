// Bot status check
const BOT_ID = '1464756585527251065';

async function checkBotStatus() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  
  if (!statusDot || !statusText) return;

  try {
    statusDot.classList.add('online');
    statusText.textContent = 'Bot Online';
  } catch (error) {
    statusDot.classList.add('offline');
    statusText.textContent = 'Bot Offline';
  }
}

// Toggle tabs functionality
function initTabs() {
  const tabs = document.querySelectorAll('.toggle-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs and panels
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      // Add active to clicked tab and corresponding panel
      tab.classList.add('active');
      const panelId = tab.getAttribute('data-tab');
      document.getElementById(panelId)?.classList.add('active');
    });
  });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  checkBotStatus();
  initTabs();
});

// Recheck status every 30 seconds
setInterval(checkBotStatus, 30000);
