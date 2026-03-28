import {
    Adb,
    AdbDaemonTransport
} from '@yume-chan/adb';
import {
    AdbDaemonWebUsbDeviceManager,
} from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';

let device;
let adb;
let monitorInFlight = false;
let myChart;
let disconnectInFlight = false;
let connectionEpoch = 0;

function isBenignSocketClosedError(err) {
    if (!err) return false;
    const msg = typeof err === 'string' ? err : (err.message || '');
    return msg.includes('Socket closed');
}

window.addEventListener('unhandledrejection', (event) => {
    // WebADB can emit this during normal transport teardown.
    if (isBenignSocketClosedError(event.reason)) {
        event.preventDefault();
    }
});

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const importCsvInput = document.getElementById('importCsvInput');
const statusBadge = document.getElementById('status');
const errorBox = document.getElementById('errorBox');
const rawText = document.getElementById('rawText');

// Dashboard elements
const levelGauge = document.getElementById('levelGauge');
const valHealth = document.getElementById('valHealth');
const valCycles = document.getElementById('valCycles');
const valTemp = document.getElementById('valTemp');
const valLevel = document.getElementById('valLevel');
const valStatus = document.getElementById('valStatus');
const valSource = document.getElementById('valSource');
const valCurrent = document.getElementById('valCurrent');
const valVoltage = document.getElementById('valVoltage');
const valChargeCounter = document.getElementById('valChargeCounter');
const valChargingPolicy = document.getElementById('valChargingPolicy');
const valChargingState = document.getElementById('valChargingState');
const valProtectMode = document.getElementById('valProtectMode');
const valProtectThreshold = document.getElementById('valProtectThreshold');
const valMaxCurrent = document.getElementById('valMaxCurrent');
const valMaxVoltage = document.getElementById('valMaxVoltage');
const stateChips = document.getElementById('stateChips');
const commandLogText = document.getElementById('commandLogText');
const insightStatus = document.getElementById('insightStatus');
const insightHealth = document.getElementById('insightHealth');
const insightProtection = document.getElementById('insightProtection');
const insightTemp = document.getElementById('insightTemp');
const insightUsage = document.getElementById('insightUsage');
const insightRecords = document.getElementById('insightRecords');
const insightNuggets = document.getElementById('insightNuggets');
const sumHealth = document.getElementById('sumHealth');
const sumHealthLoss = document.getElementById('sumHealthLoss');
const sumFirstUse = document.getElementById('sumFirstUse');
const sumManufactured = document.getElementById('sumManufactured');
const sumBootGap = document.getElementById('sumBootGap');
const sumAge = document.getElementById('sumAge');
const sumTemp = document.getElementById('sumTemp');
const sumLimit = document.getElementById('sumLimit');
const sumChargeSpeed = document.getElementById('sumChargeSpeed');
const sumFullCycles = document.getElementById('sumFullCycles');
const sumCyclesPerDay = document.getElementById('sumCyclesPerDay');
const sumFullHours = document.getElementById('sumFullHours');
const sumPeakTemp = document.getElementById('sumPeakTemp');
const sumPeakCurrent = document.getElementById('sumPeakCurrent');
const sumRemain = document.getElementById('sumRemain');
const sumBatteryQr = document.getElementById('sumBatteryQr');
const sumIcAuth = document.getElementById('sumIcAuth');

connectBtn.addEventListener('click', connectToDevice);
disconnectBtn.addEventListener('click', disconnectDevice);
exportCsvBtn.addEventListener('click', exportCsv);
importCsvBtn.addEventListener('click', () => importCsvInput.click());
importCsvInput.addEventListener('change', importCsv);

// Init Chart.js
function initChart() {
    const chartCanvas = document.getElementById('batteryChart');
    if (!chartCanvas || typeof Chart === 'undefined') {
        myChart = null;
        return;
    }

    const ctx = chartCanvas.getContext('2d');
    if (!ctx) {
        myChart = null;
        return;
    }

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Battery Level (%)',
                data: [],
                borderColor: '#ce5328',
                backgroundColor: 'rgba(206, 83, 40, 0.22)',
                borderWidth: 2,
                fill: true,
                tension: 0.25
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: '#1f1c16',
                        font: {
                            family: 'Space Grotesk, Trebuchet MS, Segoe UI, sans-serif',
                            weight: 700,
                        },
                    },
                },
            },
            scales: {
                y: {
                    ticks: { color: '#595447' },
                    grid: { color: 'rgba(89, 84, 71, 0.16)' },
                    min: 0,
                    max: 100
                },
                x: {
                    ticks: { color: '#595447' },
                    grid: { color: 'rgba(89, 84, 71, 0.12)' },
                },
            }
        }
    });
}
initChart();

async function connectToDevice() {
    clearError();
    try {
        const Manager = AdbDaemonWebUsbDeviceManager.BROWSER;
        if (!Manager) {
            showError("WebUSB is not supported in this browser. Please use Chrome/Edge.");
            return;
        }

        device = await Manager.requestDevice();
        if (!device) return;
        
        const credentialStore = new AdbWebCredentialStore();

        // Let the device create its own connection stream.
        // device.connect() returns the connection object directly!
        const connection = await device.connect();

        const transport = await AdbDaemonTransport.authenticate({
            serial: device.serial,
            connection: connection,
            credentialStore,
        });

        adb = new Adb(transport);
        const thisConnectionEpoch = ++connectionEpoch;

        statusBadge.textContent = "Connected";
        statusBadge.className = "status-connected";
        connectBtn.style.display = "none";
        disconnectBtn.style.display = "inline-block";

        watchTransportDisconnect(thisConnectionEpoch);

        startMonitoring();
    } catch (err) {
        showError(`Failed to connect: ${err.message}`);
        console.error(err);
    }
}

async function startMonitoring() {
    // Single report mode: query once on connect.
    await fetchBatteryData();
}

async function disconnectDevice() {
    clearError();
    await setDisconnectedState({ closeTransport: true });
}

async function watchTransportDisconnect(epoch) {
    if (!adb) return;

    try {
        await adb.disconnected;
    } catch (err) {
        if (!isBenignSocketClosedError(err)) {
            console.error('Transport disconnect watcher error:', err);
        }
    }

    // Ignore stale watchers from previous connections.
    if (epoch !== connectionEpoch || !adb) return;

    await setDisconnectedState({
        closeTransport: false,
        disconnectMessage: 'USB connection lost. Reconnect the cable and click Connect Device.'
    });
}

async function setDisconnectedState({ closeTransport, disconnectMessage = '' } = {}) {
    if (disconnectInFlight) return;
    disconnectInFlight = true;

    const currentAdb = adb;
    adb = null;
    device = null;
    monitorInFlight = false;

    if (closeTransport && currentAdb) {
        try {
            await currentAdb.close();
        } catch (err) {
            if (!isBenignSocketClosedError(err)) {
                console.error('Error while closing adb transport:', err);
            }
        }
    }

    statusBadge.textContent = "Disconnected";
    statusBadge.className = "status-disconnected";
    connectBtn.style.display = "inline-block";
    disconnectBtn.style.display = "none";

    if (disconnectMessage) {
        showError(disconnectMessage);
    }

    disconnectInFlight = false;
}

async function fetchBatteryData() {
    if (!adb || monitorInFlight) return;

    monitorInFlight = true;

    try {
        // Run dumpsys battery via shell and normalize different return shapes.
        const command = 'dumpsys battery';
        appendCommandLog(command);
        const outputResult = await adb.subprocess.noneProtocol.spawnWaitText(command);
        const outputText = normalizeCommandOutput(outputResult);
        
        rawText.textContent = outputText;
        parseBatteryData(outputText);
    } catch (err) {
        showError(`Monitor error: ${err.message}`);
        setDisconnectedState({ closeTransport: true });
    } finally {
        monitorInFlight = false;
    }
}

function normalizeCommandOutput(result) {
    if (typeof result === 'string') {
        return result;
    }

    if (result instanceof Uint8Array) {
        return new TextDecoder().decode(result);
    }

    if (result && typeof result === 'object') {
        if (typeof result.stdout === 'string') {
            return result.stdout;
        }
        if (result.stdout instanceof Uint8Array) {
            return new TextDecoder().decode(result.stdout);
        }
        if (result.stdout && typeof result.stdout.toString === 'function') {
            return result.stdout.toString();
        }
    }

    throw new Error('Unexpected adb shell output type.');
}

function appendCommandLog(command) {
    if (!commandLogText) return;

    const now = new Date();
    const timestamp = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const line = `${timestamp}  ${command}`;

    if (commandLogText.textContent === 'No commands sent yet.') {
        commandLogText.textContent = line;
        return;
    }

    commandLogText.textContent += `\n${line}`;
}

function parseBatteryData(dumpText) {
    const asoc =
        parseBracketValue(dumpText, 'mSavedBatteryAsoc') ??
        parseIntegerLine(dumpText, 'mSavedBatteryAsoc') ??
        parseEfsNumericValue(dumpText, 'AsocData');

    const savedUsage =
        parseBracketValue(dumpText, 'mSavedBatteryUsage') ??
        parseIntegerLine(dumpText, 'mSavedBatteryUsage') ??
        parseEfsNumericValue(dumpText, 'DischargeLevelData');

    const fullStatusDuration =
        parseBracketValue(dumpText, 'mSavedFullStatusDuration') ??
        parseIntegerLine(dumpText, 'mSavedFullStatusDuration') ??
        parseEfsNumericValue(dumpText, 'FullStatusUsageData');

    const data = {
        level: parseIntegerLine(dumpText, 'level'),
        status: parseIntegerLine(dumpText, 'status'),
        healthCode: parseIntegerLine(dumpText, 'health'),
        tempRaw: parseIntegerLine(dumpText, 'temperature'),
        voltage: parseIntegerLine(dumpText, 'voltage'),
        currentNow: parseIntegerLine(dumpText, 'current now'),
        chargeCounter: parseIntegerLine(dumpText, 'Charge counter') ?? parseIntegerLine(dumpText, 'charge counter'),
        chargingState: parseIntegerLine(dumpText, 'Charging state'),
        chargingPolicy: parseIntegerLine(dumpText, 'Charging policy'),
        maxChargingCurrent: parseIntegerLine(dumpText, 'Max charging current'),
        maxChargingVoltage: parseIntegerLine(dumpText, 'Max charging voltage'),
        protectMode: parseIntegerLine(dumpText, 'mProtectBatteryMode'),
        protectionThreshold: parseIntegerLine(dumpText, 'mProtectionThreshold'),
        asoc,
        savedUsage,
        fullStatusDuration,
        firstUseDate: parseBracketValue(dumpText, 'battery FirstUseDate'),
        firstUseDateEfs: parseEfsValue(dumpText, 'FirstUseDateData'),
        batteryQrPartNumber: parseEfsTextValue(dumpText, 'QrData'),
        llbManufacturedDate: normalizeDateToken(parseLineValue(dumpText, 'LLB MAN')),
        savedBsoh: parseFloatLine(dumpText, 'mSavedBatteryBsoh'),
        savedMaxTemp: parseIntegerLine(dumpText, 'mSavedBatteryMaxTemp'),
        savedMaxCurrent: parseIntegerLine(dumpText, 'mSavedBatteryMaxCurrent'),
        icAuthResult: parseBracketValue(dumpText, 'battery IcAuthenticationResults'),
        remainSeconds: parseLatestActionMetric(dumpText, 'remain'),
        acPowered: parseBooleanLine(dumpText, 'AC powered'),
        usbPowered: parseBooleanLine(dumpText, 'USB powered'),
        wirelessPowered: parseBooleanLine(dumpText, 'Wireless powered'),
        dockPowered: parseBooleanLine(dumpText, 'Dock powered'),
        ledCharging: parseBooleanLine(dumpText, 'LED Charging'),
        ledLowBattery: parseBooleanLine(dumpText, 'LED Low Battery'),
        adaptiveFastCharging: parseBooleanLine(dumpText, 'Adaptive Fast Charging Settings'),
        superFastCharging: parseBooleanLine(dumpText, 'Super Fast Charging Settings'),
    };

    updateDashboard(data);
}

function updateDashboard(data) {
    const level = data.level ?? 0;
    const tempC = typeof data.tempRaw === 'number' ? (data.tempRaw / 10) : null;
    const firstUseRaw = selectFirstUseDate(data);
    const firstUseFormatted = formatDateYYYYMMDD(firstUseRaw);
    const manufacturedRaw = data.llbManufacturedDate;
    const manufacturedFormatted = formatDateYYYYMMDD(manufacturedRaw);
    const bootGapDays = daysBetweenDateTokens(manufacturedRaw, firstUseRaw);
    const batteryAgeDays = calcAgeInDays(firstUseRaw);
    const batteryAgeMonths = calcAgeInMonths(firstUseRaw);
    const healthLoss = typeof data.asoc === 'number' ? Math.max(0, 100 - data.asoc) : null;
    const chargeLimit = typeof data.protectionThreshold === 'number' ? data.protectionThreshold : null;
    const chargingSpeed = classifyChargeSpeed(data.currentNow, data.adaptiveFastCharging, data.superFastCharging);
    const fullCycles = toFullCycles(data.savedUsage);
    const cyclesPerDay = toCyclesPerDay(fullCycles, batteryAgeDays);
    const fullStatusHours = minutesToHours(data.fullStatusDuration);
    const peakTempC = tenthCToC(data.savedMaxTemp);
    const peakCurrentA = milliAmpToAmp(data.savedMaxCurrent);

    valLevel.textContent = formatPercent(level);
    valStatus.textContent = batteryStatusText(data.status);
    valSource.textContent = powerSourceText(data);
    valHealth.textContent = formatPercent(data.asoc);
    valCurrent.textContent = formatUnit(data.currentNow, 'mA');

    valTemp.textContent = formatUnit(tempC, '°C', 1);
    valVoltage.textContent = formatUnit(data.voltage, 'mV');
    valChargeCounter.textContent = formatChargeCounter(data.chargeCounter);
    valCycles.textContent = formatCycleEstimate(data.savedUsage);

    if (valChargingPolicy) valChargingPolicy.textContent = valueOrDash(data.chargingPolicy);
    if (valChargingState) valChargingState.textContent = valueOrDash(data.chargingState);
    if (valProtectMode) valProtectMode.textContent = valueOrDash(data.protectMode);
    if (valProtectThreshold) valProtectThreshold.textContent = formatUnit(data.protectionThreshold, '%');
    if (valMaxCurrent) valMaxCurrent.textContent = formatUnit(data.maxChargingCurrent, 'mA');
    if (valMaxVoltage) valMaxVoltage.textContent = formatUnit(data.maxChargingVoltage, 'mV');

    renderStateChips(data);
    renderInsights({
        level,
        tempC,
        chargeLimit,
        firstUseFormatted,
        manufacturedFormatted,
        bootGapDays,
        batteryAgeDays,
        batteryAgeMonths,
        healthLoss,
        chargingSpeed,
        fullCycles,
        cyclesPerDay,
        fullStatusHours,
        peakTempC,
        peakCurrentA,
        data,
    });

    if (typeof level === 'number' && levelGauge) {
        levelGauge.style.setProperty('--level', String(Math.max(0, Math.min(100, level))));
    }

    // Optional chart support if chart canvas is present.
    if (myChart) {
        const now = new Date();
        const timeLabel = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');

        myChart.data.labels.push(timeLabel);
        myChart.data.datasets[0].data.push(level);

        // Keep last 50 data points max
        if (myChart.data.labels.length > 50) {
            myChart.data.labels.shift();
            myChart.data.datasets[0].data.shift();
        }
        myChart.update();
    }
}

function renderInsights(model) {
    const {
        level,
        tempC,
        chargeLimit,
        firstUseFormatted,
        manufacturedFormatted,
        bootGapDays,
        batteryAgeDays,
        batteryAgeMonths,
        healthLoss,
        chargingSpeed,
        fullCycles,
        cyclesPerDay,
        fullStatusHours,
        peakTempC,
        peakCurrentA,
        data,
    } = model;

    const statusSentence = `Battery is at ${formatPercent(level)} on ${powerSourceText(data)} power (${batteryStatusText(data.status)}), drawing ${formatUnit(data.currentNow, 'mA')}.`;
    const healthSentence = `ASOC is ${formatPercent(data.asoc)} with an estimated ${healthLossText(healthLoss)} capacity drop since new; saved BSOH is ${formatUnit(data.savedBsoh, '%', 2)}.`;
    const protectionSentence = `Protection mode is ${valueOrDash(data.protectMode)} with a charge limit of ${chargeLimitText(chargeLimit)}. Charging speed is currently ${chargingSpeed}.`;
    const tempSentence = `Battery temperature is ${formatUnit(tempC, '°C', 1)}, which is ${temperatureBandText(tempC)}.`;
    const usageSentence = `Usage is ${fullCyclesText(fullCycles)}, averaging ${cyclesPerDayText(cyclesPerDay)} across ${daysText(batteryAgeDays)}. Full-status time is ${hoursText(fullStatusHours)}.`;
    const recordsSentence = `Peak recorded events: ${peakTempText(peakTempC)} and ${peakCurrentText(peakCurrentA)}.`;
    const nuggetsSentence = `Manufactured ${manufacturedFormatted}, first used ${firstUseFormatted} (${bootGapText(bootGapDays)}). Latest remain estimate: ${remainText(data.remainSeconds)}. IC authentication: ${icAuthText(data.icAuthResult)}.`;

    if (insightStatus) insightStatus.textContent = statusSentence;
    if (insightHealth) insightHealth.textContent = healthSentence;
    if (insightProtection) insightProtection.textContent = protectionSentence;
    if (insightTemp) insightTemp.textContent = tempSentence;
    if (insightUsage) insightUsage.textContent = usageSentence;
    if (insightRecords) insightRecords.textContent = recordsSentence;
    if (insightNuggets) insightNuggets.textContent = nuggetsSentence;

    if (sumHealth) sumHealth.textContent = formatPercent(data.asoc);
    if (sumHealthLoss) sumHealthLoss.textContent = healthLossText(healthLoss);
    if (sumFirstUse) sumFirstUse.textContent = firstUseFormatted;
    if (sumManufactured) sumManufactured.textContent = manufacturedFormatted;
    if (sumBootGap) sumBootGap.textContent = bootGapText(bootGapDays);
    if (sumAge) sumAge.textContent = batteryAgeMonthsText(batteryAgeMonths);
    if (sumTemp) sumTemp.textContent = formatUnit(tempC, '°C', 1);
    if (sumLimit) sumLimit.textContent = chargeLimitText(chargeLimit);
    if (sumChargeSpeed) sumChargeSpeed.textContent = chargingSpeed;
    if (sumFullCycles) sumFullCycles.textContent = fullCyclesText(fullCycles);
    if (sumCyclesPerDay) sumCyclesPerDay.textContent = cyclesPerDayText(cyclesPerDay);
    if (sumFullHours) sumFullHours.textContent = hoursText(fullStatusHours);
    if (sumPeakTemp) sumPeakTemp.textContent = peakTempText(peakTempC);
    if (sumPeakCurrent) sumPeakCurrent.textContent = peakCurrentText(peakCurrentA);
    if (sumRemain) sumRemain.textContent = remainText(data.remainSeconds);
    if (sumBatteryQr) sumBatteryQr.textContent = valueOrDash(data.batteryQrPartNumber);
    if (sumIcAuth) sumIcAuth.textContent = icAuthText(data.icAuthResult);
}

function parseLineValue(text, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'mi');
    const match = text.match(re);
    return match ? match[1].trim() : null;
}

function parseIntegerLine(text, key) {
    const raw = parseLineValue(text, key);
    if (!raw) return null;
    const match = raw.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null;
}

function parseFloatLine(text, key) {
    const raw = parseLineValue(text, key);
    if (!raw) return null;
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
}

function parseBooleanLine(text, key) {
    const raw = parseLineValue(text, key);
    if (!raw) return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
}

function parseBracketValue(text, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}:\\s*\\[([^\]]+)\\]`, 'i');
    const match = text.match(re);
    if (!match) return null;
    const raw = match[1].trim();
    const num = Number(raw);
    return Number.isNaN(num) ? raw : num;
}

function parseEfsValue(text, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s+efsValue:\\s*([^\\s]+)`, 'i');
    const match = text.match(re);
    if (!match) return null;
    const raw = match[1].trim();
    return /^\d{8}$/.test(raw) ? raw : null;
}

function parseEfsNumericValue(text, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s+efsValue:\\s*(-?\\d+)`, 'i');
    const match = text.match(re);
    return match ? parseInt(match[1], 10) : null;
}

function parseEfsTextValue(text, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s+efsValue:\\s*([^\\r\\n]+)`, 'i');
    const match = text.match(re);
    return match ? match[1].trim() : null;
}

function parseLatestActionMetric(text, metricKey) {
    const section = extractSection(text, 'BattActionChangedLogBuffer');
    if (!section) return null;
    const escaped = metricKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}:(-?\\d+)`, 'g');
    let match;
    let latest = null;
    while ((match = re.exec(section)) !== null) {
        latest = parseInt(match[1], 10);
    }
    return latest;
}

function normalizeDateToken(value) {
    if (!value) return null;
    const token = String(value).trim();
    return /^\d{8}$/.test(token) ? token : null;
}

function extractSection(text, sectionName) {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\[${escaped}\\]\\n([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]\\n|$)`, 'm');
    const match = text.match(re);
    return match ? match[1].trim() : '';
}

function formatPercent(value) {
    return typeof value === 'number' ? `${value}%` : '--%';
}

function formatNumber(value) {
    return typeof value === 'number' ? value.toLocaleString() : '--';
}

function formatChargeCounter(value) {
    if (typeof value !== 'number') return '--';

    // Android reports BATTERY_PROPERTY_CHARGE_COUNTER in uAh on most devices.
    if (Math.abs(value) >= 10000) {
        const mah = value / 1000;
        return `${mah.toLocaleString(undefined, { maximumFractionDigits: 0 })} mAh`;
    }

    return `${value.toLocaleString()} mAh`;
}

function formatUnit(value, unit, digits = null) {
    if (typeof value !== 'number') return `-- ${unit}`;
    const rendered = typeof digits === 'number' ? value.toFixed(digits) : value.toLocaleString();
    return `${rendered} ${unit}`;
}

function valueOrDash(value) {
    if (value === null || value === undefined || value === '') return '--';
    return String(value);
}

function formatCycleEstimate(savedUsage) {
    if (typeof savedUsage !== 'number') return '--';
    return Math.max(0, Math.round(savedUsage / 100)).toLocaleString();
}

function formatDateYYYYMMDD(value) {
    if (!value) return '--';
    const raw = String(value);
    if (/^\d{8}$/.test(raw)) {
        return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    return raw;
}

function selectFirstUseDate(data) {
    return data.firstUseDate ?? data.firstUseDateEfs ?? null;
}

function calcAgeInMonths(rawDate) {
    if (!rawDate) return null;
    const value = String(rawDate);
    if (!/^\d{8}$/.test(value)) return null;
    const year = parseInt(value.slice(0, 4), 10);
    const month = parseInt(value.slice(4, 6), 10);
    const day = parseInt(value.slice(6, 8), 10);
    const start = new Date(year, month - 1, day);
    if (Number.isNaN(start.getTime())) return null;

    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() < start.getDate()) months -= 1;
    return Math.max(0, months);
}

function calcAgeInDays(rawDate) {
    if (!rawDate) return null;
    const value = String(rawDate);
    if (!/^\d{8}$/.test(value)) return null;
    const year = parseInt(value.slice(0, 4), 10);
    const month = parseInt(value.slice(4, 6), 10);
    const day = parseInt(value.slice(6, 8), 10);
    const start = new Date(year, month - 1, day);
    if (Number.isNaN(start.getTime())) return null;
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function daysBetweenDateTokens(fromDate, toDate) {
    if (!fromDate || !toDate) return null;
    if (!/^\d{8}$/.test(String(fromDate)) || !/^\d{8}$/.test(String(toDate))) return null;
    const from = new Date(parseInt(String(fromDate).slice(0, 4), 10), parseInt(String(fromDate).slice(4, 6), 10) - 1, parseInt(String(fromDate).slice(6, 8), 10));
    const to = new Date(parseInt(String(toDate).slice(0, 4), 10), parseInt(String(toDate).slice(4, 6), 10) - 1, parseInt(String(toDate).slice(6, 8), 10));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    const diff = to.getTime() - from.getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function toFullCycles(savedUsage) {
    if (typeof savedUsage !== 'number') return null;
    return savedUsage / 100;
}

function toCyclesPerDay(fullCycles, ageDays) {
    if (typeof fullCycles !== 'number' || typeof ageDays !== 'number' || ageDays <= 0) return null;
    return fullCycles / ageDays;
}

function minutesToHours(minutes) {
    if (typeof minutes !== 'number') return null;
    return minutes / 60;
}

function tenthCToC(rawTenthC) {
    if (typeof rawTenthC !== 'number') return null;
    return rawTenthC / 10;
}

function milliAmpToAmp(currentMa) {
    if (typeof currentMa !== 'number') return null;
    return currentMa / 1000;
}

function fullCyclesText(cycles) {
    if (typeof cycles !== 'number') return '--';
    return `${cycles.toFixed(0)} cycles`;
}

function cyclesPerDayText(value) {
    if (typeof value !== 'number') return '--';
    return `${value.toFixed(2)} / day`;
}

function hoursText(hours) {
    if (typeof hours !== 'number') return '--';
    return `${hours.toFixed(0)} h`;
}

function peakTempText(tempC) {
    if (typeof tempC !== 'number') return '--';
    return `${tempC.toFixed(1)}°C peak`;
}

function peakCurrentText(currentA) {
    if (typeof currentA !== 'number') return '--';
    return `${currentA.toFixed(2)} A peak`;
}

function remainText(seconds) {
    if (typeof seconds !== 'number') return '--';
    const mins = Math.round(seconds / 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${seconds}s (~${h}h ${m}m)`;
}

function icAuthText(value) {
    if (value === null || value === undefined) return '--';
    return String(value);
}

function bootGapText(days) {
    if (typeof days !== 'number') return '--';
    return `${days} days`;
}

function daysText(days) {
    if (typeof days !== 'number') return '--';
    return `${days} days`;
}

function batteryAgeMonthsText(months) {
    if (typeof months !== 'number') return '--';
    if (months < 1) return '<1 month';
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    const remain = months % 12;
    if (remain === 0) return `${years} years`;
    return `${years}y ${remain}m`;
}

function healthLossText(loss) {
    if (typeof loss !== 'number') return '--';
    return `${loss}%`;
}

function chargeLimitText(limit) {
    if (typeof limit !== 'number') return '--';
    return `${limit}% (active)`;
}

function temperatureBandText(tempC) {
    if (typeof tempC !== 'number') return 'unknown';
    if (tempC < 35) return 'cool and safe';
    if (tempC < 42) return 'normal';
    if (tempC < 47) return 'warm';
    return 'hot';
}

function classifyChargeSpeed(currentNow, adaptiveFastCharging, superFastCharging) {
    if (superFastCharging === true) return 'super fast';
    if (adaptiveFastCharging === true) return 'adaptive fast';
    if (typeof currentNow !== 'number') return 'unknown';
    if (currentNow >= 2500) return 'fast';
    if (currentNow >= 1200) return 'standard';
    if (currentNow > 0) return 'slow';
    return 'not charging';
}

function formatDurationMinutes(minutes) {
    if (typeof minutes !== 'number') return '--';
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h ${minutes % 60}m`;
}

function batteryStatusText(statusCode) {
    const map = {
        1: 'Unknown',
        2: 'Charging',
        3: 'Discharging',
        4: 'Not Charging',
        5: 'Full'
    };
    return map[statusCode] || 'Unknown';
}

function powerSourceText(data) {
    const sources = [];
    if (data.acPowered) sources.push('AC');
    if (data.usbPowered) sources.push('USB');
    if (data.wirelessPowered) sources.push('Wireless');
    if (data.dockPowered) sources.push('Dock');
    if (sources.length === 0) return 'Battery';
    return sources.join(' + ');
}

function renderStateChips(data) {
    if (!stateChips) return;

    const chips = [
        { label: `Health ${healthText(data.healthCode)}` },
        { label: data.ledCharging === true ? 'LED Charging On' : 'LED Charging Off' },
        { label: data.ledLowBattery === true ? 'Low Battery LED On' : 'Low Battery LED Off' },
        { label: data.adaptiveFastCharging === true ? 'Adaptive Fast Charging On' : 'Adaptive Fast Charging Off' },
        { label: data.superFastCharging === true ? 'Super Fast Charging On' : 'Super Fast Charging Off' },
    ];

    stateChips.innerHTML = '';
    chips.forEach((chipData) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = chipData.label;
        stateChips.appendChild(chip);
    });
}

function healthText(code) {
    const map = {
        1: 'Unknown',
        2: 'Good',
        3: 'Overheat',
        4: 'Dead',
        5: 'Over Voltage',
        6: 'Unspecified Failure',
        7: 'Cold'
    };
    return map[code] || 'Unknown';
}

function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = "block";
}

function clearError() {
    errorBox.textContent = "";
    errorBox.style.display = "none";
}

function exportCsv() {
    const text = rawText.textContent;
    if (!text || text === 'No data yet.') return;
    
    const lines = text.split('\n');
    let csvContent = 'Key,Value\n';
    
    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
            const key = line.substring(0, colonIdx).trim().replace(/"/g, '""');
            const value = line.substring(colonIdx + 1).trim().replace(/"/g, '""');
            csvContent += `"${key}","${value}"\n`;
        } else {
            const val = line.trim().replace(/"/g, '""');
            if (val) {
                csvContent += `"${val}",""\n`;
            }
        }
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'battery_dump.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function importCsv(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const csv = e.target.result;
        const lines = csv.split('\n');
        let dumpText = '';
        
        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const firstComma = line.indexOf('","');
            if (firstComma !== -1) {
                let key = line.substring(1, firstComma).replace(/""/g, '"');
                let value = line.substring(firstComma + 3, line.length - 1).replace(/""/g, '"');
                if (value) {
                    dumpText += `  ${key}: ${value}\n`;
                } else {
                    dumpText += `${key}\n`;
                }
            } else {
                let val = line.replace(/^"|"$/g, '').replace(/""/g, '"');
                dumpText += `${val}\n`;
            }
        }
        
        rawText.textContent = dumpText;
        parseBatteryData(dumpText);
        
        statusBadge.textContent = "Data Imported";
        statusBadge.className = "status-connected";
        connectBtn.style.display = "none";
        disconnectBtn.style.display = "inline-block";
    };
    reader.readAsText(file);
    
    // reset input
    event.target.value = '';
}
