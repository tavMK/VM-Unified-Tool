// --- CONFIGURATION ---
// PASTE YOUR NEW GOOGLE SCRIPT WEB APP URL HERE
const API_URL = "https://script.google.com/macros/s/AKfycby7jiogq43tSOL2lqK04Gf731mVT6_3Nsb3R8ObCUBrmhY6JDGxsbTi6Ek2SwIIZbsh/exec"; 

let currentUser = null;
let currentMode = ''; 
let selectedId = null;
let dbData = []; 

window.onload = () => {
    const savedUser = localStorage.getItem('vm_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showApp();
    }
};

// --- NEW: SESSION LOGGING FUNCTION ---
// Uses sendBeacon for reliable transmission during tab close
function logSession(actionType) {
    if (!currentUser) return;

    const logData = {
        user: currentUser.name || "Unknown",
        action: actionType,
        timestamp: new Date().toString()
    };

    // Blob is required for sendBeacon to send JSON correctly
    const blob = new Blob([JSON.stringify(logData)], { type: 'application/json' });
    
    // Sends data asynchronously to Google Sheet
    navigator.sendBeacon(`${API_URL}?action=logSession`, blob);
}

// --- NEW: DETECT TAB CLOSE / HIDE ---
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
        // Log when user minimizes window, switches tab, or closes browser
        logSession('Session Background/Close');
    }
});

// --- REAL LOGIN FUNCTION ---
async function handleLogin(e) {
    e.preventDefault();
    showLoading(true);
    
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();

    try {
        // Sends request to Google Sheet to check "Users" tab
        const res = await fetch(`${API_URL}?action=login&username=${u}&password=${p}`);
        const data = await res.json();

        if (data.status === 'success') {
            currentUser = data.user;
            localStorage.setItem('vm_user', JSON.stringify(currentUser));
            
            // [UPDATED] Log Login
            logSession('Login');
            
            showApp();
        } else {
            alert("Login Failed: " + data.message);
        }
    } catch (err) {
        alert("Connection Error: " + err);
    } finally {
        showLoading(false);
    }
}

function logout() {
    // [UPDATED] Log Logout before clearing data
    logSession('Logout');

    localStorage.removeItem('vm_user');
    currentUser = null;
    location.reload();
}

// --- DATA SYNC ---
async function refreshData() {
    showLoading(true);
    try {
        const res = await fetch(`${API_URL}?action=getPlans`);
        const json = await res.json();
        if(json.status === 'success') {
            dbData = json.data;
            if(!document.getElementById('admin-view').classList.contains('hidden')) renderAdminTable();
            if(!document.getElementById('filter-view').classList.contains('hidden')) applyFilter();
        }
    } catch (err) { console.error(err); } 
    finally { showLoading(false); }
}

// --- NAVIGATION ---
function switchView(id) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}
function openAdminView() { switchView('admin-view'); refreshData(); }
function openFilterView() { switchView('filter-view'); refreshData(); }
function openCalculator() { switchView('calculator-view'); document.getElementById('calc-display').value=''; }

// --- FORMS ---
function openForm(mode) {
    currentMode = mode;
    switchView('data-form-view');
    resetForm();
    refreshData();

    const btn = document.getElementById('action-btn');
    const searchSec = document.getElementById('search-section');
    const mainForm = document.getElementById('main-form');
    const extraFields = document.querySelectorAll('.extra-field');
    const partInput = document.getElementById('f-partNo');

    if (mode === 'add') {
        selectedId = null;
        document.getElementById('form-title').textContent = 'Add New Plan';
        searchSec.classList.add('hidden');
        mainForm.classList.remove('hidden');
        extraFields.forEach(el => el.classList.add('hidden'));
        partInput.readOnly = false;
        partInput.style.background = "var(--input-bg)";
        btn.textContent = "SAVE NEW";
        btn.className = "btn btn-success";
        btn.onclick = saveRecord;
    } else {
        searchSec.classList.remove('hidden');
        mainForm.classList.add('hidden');
        extraFields.forEach(el => el.classList.remove('hidden'));
        partInput.readOnly = true;
        partInput.style.background = "#e0e0e0";

        if (mode === 'delete') {
            document.getElementById('form-title').textContent = 'Delete Plan';
            btn.textContent = "DELETE RECORD";
            btn.className = "btn btn-danger";
            btn.onclick = deleteRecord;
        } else {
            document.getElementById('form-title').textContent = 'Update Plan';
            btn.textContent = "UPDATE RECORD";
            btn.className = "btn btn-primary";
            btn.onclick = saveRecord;
        }
    }
}

function performSearch() {
    const term = document.getElementById('search-input').value.toLowerCase().trim();
    const list = document.getElementById('search-results');
    if(!term) { list.classList.add('hidden'); return; }
    
    list.innerHTML = '';
    const filtered = dbData.filter(item => 
        String(item.partNo).toLowerCase().includes(term) || 
        String(item.description).toLowerCase().includes(term)
    );

    if(filtered.length === 0) {
        list.innerHTML = '<div style="padding:10px; text-align:center;">No matches</div>';
    } else {
        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `<div><b>${item.partNo}</b><br><small>${item.description}</small></div>`;
            div.onclick = () => {
                selectedId = item.id; 
                populateForm(item);
            };
            list.appendChild(div);
        });
    }
    list.classList.remove('hidden');
}

function populateForm(item) {
    document.getElementById('search-results').classList.add('hidden');
    document.getElementById('main-form').classList.remove('hidden');
    
    document.getElementById('f-partNo').value = item.partNo || '';
    document.getElementById('f-description').value = item.description || '';
    document.getElementById('f-quantity').value = item.quantity || '';
    document.getElementById('f-planDate').value = formatDate(item.planDate);
    document.getElementById('f-completedQty').value = item.completedQty || 0;
    document.getElementById('f-todayQty').value = '';
    document.getElementById('f-status').value = item.status || 'Scheduled';
    document.getElementById('f-preOba').value = item.preOba || '';
    document.getElementById('f-packing').value = item.packing || '';
    document.getElementById('f-afterOba').value = item.afterOba || '';
    document.getElementById('f-completedDate').value = formatDate(item.completedDate);
}

async function saveRecord() {
    const currentTotal = parseInt(document.getElementById('f-completedQty').value) || 0;
    const addedToday = parseInt(document.getElementById('f-todayQty').value) || 0;
    const newTotal = currentTotal + addedToday;

    const formData = {
        id: selectedId,
        partNo: document.getElementById('f-partNo').value,
        description: document.getElementById('f-description').value,
        quantity: document.getElementById('f-quantity').value,
        planDate: document.getElementById('f-planDate').value,
        completedQty: newTotal,
        status: document.getElementById('f-status').value,
        preOba: document.getElementById('f-preOba').value,
        packing: document.getElementById('f-packing').value,
        afterOba: document.getElementById('f-afterOba').value,
        completedDate: document.getElementById('f-completedDate').value,
        user: currentUser.name
    };

    if(!formData.partNo) return alert("Part No Required");

    let action = 'addPlan';
    if (currentMode === 'update') {
        if(!selectedId) return alert("Error: No Record Selected");
        action = 'updatePlan';
    }

    showLoading(true);
    try {
        const res = await fetch(API_URL + `?action=${action}`, {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        const result = await res.json();
        if (result.status === 'success') {
            alert("Success");
            switchView('datasheet-menu');
            refreshData();
        } else {
            alert("Error: " + result.message);
        }
    } catch(err) { alert("Error: " + err); } 
    finally { showLoading(false); }
}

async function deleteRecord() {
    if(!confirm("Delete permanently?")) return;
    if(!selectedId) return alert("No selection");
    showLoading(true);
    try {
        const res = await fetch(`${API_URL}?action=deletePlan&id=${selectedId}`);
        const r = await res.json();
        if(r.status === 'success') {
            alert("Deleted");
            switchView('datasheet-menu');
            refreshData();
        }
    } catch(e) { alert(e); } 
    finally { showLoading(false); }
}

// --- HELPERS ---
function renderAdminTable() {
    const c = document.getElementById('master-table-wrapper');
    if(dbData.length===0) { c.innerHTML='Loading...'; return; }
    let h = `<div class="glass-panel" style="padding:0; overflow:auto;"><table style="width:100%; border-collapse:collapse;">
    <thead style="background:rgba(138,43,226,0.1);"><tr><th style="padding:10px;">Part</th><th>Desc</th><th>Status</th><th>Action</th></tr></thead><tbody>`;
    dbData.forEach(r => {
        h+=`<tr style="border-bottom:1px solid #eee;"><td style="padding:10px;">${r.partNo}</td><td>${r.description}</td>
        <td><span style="background:${r.status==='Completed'?'#32CD32':'#8A2BE2'}; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">${r.status}</span></td>
        <td><button class="btn-ghost" style="padding:5px;" onclick="openEditFromTable('${r.id}')">✎</button></td></tr>`;
    });
    c.innerHTML = h + `</tbody></table></div>`;
}
function openEditFromTable(id) {
    const rec = dbData.find(r => String(r.id) === String(id));
    if(rec) { openForm('update'); selectedId = rec.id; setTimeout(()=>populateForm(rec),50); }
}
function applyFilter() {
    const col = document.getElementById('filter-column').value;
    const val = document.getElementById('filter-value').value.toLowerCase();
    const c = document.getElementById('filter-results');
    c.innerHTML = '';
    const f = dbData.filter(r => String(r[col]||'').toLowerCase().includes(val));
    let h = `<table style="width:100%;"><thead><tr><th>Part</th><th>Val</th></tr></thead><tbody>`;
    f.forEach(r => h+=`<tr><td>${r.partNo}</td><td>${r[col]}</td></tr>`);
    c.innerHTML = h+'</tbody></table>';
}
function calcAppend(v) { document.getElementById('calc-display').value += v; }
function calcOp(v) { document.getElementById('calc-display').value += v; }
function calcClear() { document.getElementById('calc-display').value = ''; }
function calcResult() { try{document.getElementById('calc-display').value=eval(document.getElementById('calc-display').value)}catch{document.getElementById('calc-display').value='Err'} }
function formatDate(d) { if(!d)return ''; const x=new Date(d); return isNaN(x)?d:x.toISOString().split('T')[0]; }
function resetForm() { document.querySelectorAll('input').forEach(e => {if(e.id!=='search-input')e.value=''}); document.getElementById('search-results').innerHTML=''; }
function showLoading(s) { document.getElementById('loading-overlay').classList.toggle('hidden', !s); }
function showApp() { document.getElementById('login-view').classList.add('hidden'); document.getElementById('app-wrapper').classList.remove('hidden'); refreshData(); }
// Update display user info
if(currentUser && document.getElementById('display-username')) {
    document.getElementById('display-username').textContent = currentUser.name || "User";
    document.getElementById('display-role').textContent = currentUser.role || "Operator";
}
