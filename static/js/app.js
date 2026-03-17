// ---- STATE ----
let state = {};
let empCurrentBE = '';

async function init() {
  const res = await fetch('/api/state');
  state = await res.json();
  renderAll();
}

function renderAll() {
  // Project
  setVal('project_title', state.project_title || '');
  setVal('project_acronym', state.project_acronym || '');
  setVal('coordinator_contact', state.coordinator_contact || '');
  setVal('project_duration_months', state.project_duration_months || 24);
  document.getElementById('header-subtitle').textContent =
    (state.project_acronym || 'Projet') + (state.project_title ? ' – ' + state.project_title : '');
  // Lists
  renderBEList();
  renderWPList();
  populateCostSelects();
  renderDepreciation();
  renderComments();
  renderSubcontracting();
  populateGanttWPSelect();
  renderGantt();
  renderPreviousProjects();
  renderRisks();
  renderStaffTable();
  // Part B text fields
  const pb = state.part_b || {};
  const pbFields = ['summary','objectives','policy_contribution','digital_supply_chain',
    'financial_obstacles','maturity','implementation_plan','project_management',
    'cost_effectiveness','consortium_cooperation','outside_resources','consortium_management',
    'expected_outcomes','dissemination','competitiveness','environmental','work_plan_overview',
    'ethics','security','double_funding_detail','financial_support_justification'];
  pbFields.forEach(f => setVal('pb_' + f, pb[f] || ''));
  const dfCheck = document.getElementById('pb_double_funding_confirmed');
  if (dfCheck) dfCheck.checked = pb.double_funding_confirmed !== false;
  populateEmployeeBESelect();
  if (state.beneficiaries && state.beneficiaries.length) {
    document.getElementById('employees-card').style.display = '';
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ---- TABS ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'costs') populateCostSelects();
    if (tab.dataset.tab === 'workpackages') renderWPDetailSelect();
  });
});

// Part B sub-tabs
document.querySelectorAll('.pb-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.pb-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pb-section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.pb).classList.add('active');
    if (tab.dataset.pb === 'pb-workplan') { populateGanttWPSelect(); renderGantt(); }
  });
});

// ---- AUTO SAVE ----
let projectTimer;
function autoSaveProject() {
  clearTimeout(projectTimer);
  projectTimer = setTimeout(async () => {
    const data = {
      project_title: document.getElementById('project_title').value,
      project_acronym: document.getElementById('project_acronym').value,
      coordinator_contact: document.getElementById('coordinator_contact').value,
      project_duration_months: parseInt(document.getElementById('project_duration_months').value) || 24,
    };
    await fetch('/api/project', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    Object.assign(state, data);
    document.getElementById('header-subtitle').textContent =
      (state.project_acronym || 'Projet') + (state.project_title ? ' – '+state.project_title : '');
    renderTimetable();
  }, 600);
}

const pbTimers = {};
function autoSavePartB(field, value) {
  clearTimeout(pbTimers[field]);
  pbTimers[field] = setTimeout(async () => {
    await fetch('/api/part_b', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({[field]: value}) });
    if (!state.part_b) state.part_b = {};
    state.part_b[field] = value;
  }, 600);
}

// ---- BENEFICIARIES ----
function showAddBE() { openModal('Ajouter un bénéficiaire', getBEForm(null)); }
function showEditBE(beId) { openModal('Modifier', getBEForm(state.beneficiaries.find(b => b.id === beId))); }

function getBEForm(be) {
  const cOpts = COUNTRIES.map(c => `<option value="${c.name}" ${be&&be.country===c.name?'selected':''}>${c.name}</option>`).join('');
  const rOpts = FUNDING_RATES.map(r => `<option value="${r.value}" ${be&&be.funding_rate==r.value?'selected':''}>${r.label}</option>`).join('');
  return `
    <div class="form-row">
      <div class="form-group"><label>Nom complet</label><input type="text" id="be_name" value="${be?esc(be.name):''}"></div>
      <div class="form-group"><label>Acronyme</label><input type="text" id="be_acronym" value="${be?esc(be.acronym):''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Pays</label><select id="be_country">${cOpts}</select></div>
      <div class="form-group"><label>Taux de financement</label><select id="be_funding_rate">${rOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Type d'organisation</label>
        <select id="be_org_type">
          ${['Université','Organisme de recherche','Entreprise privée','PME','ONG','Administration publique','Hôpital','Autre'].map(t=>`<option value="${t}" ${be&&be.org_type===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
    </div>
    <div class="form-group"><label>Description (rôle dans le projet)</label>
      <textarea id="be_description" rows="3">${be?esc(be.description||''):''}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="${be?`updateBE('${be.id}')`:'addBE()'}">${be?'Mettre à jour':'Ajouter'}</button>
    </div>`;
}

async function addBE() {
  const data = { name:v('be_name'), acronym:v('be_acronym'), country:v('be_country'),
    funding_rate:parseFloat(v('be_funding_rate')), org_type:v('be_org_type'), description:v('be_description') };
  if (!data.name) return alert('Le nom est requis.');
  const res = await post('/api/beneficiary', data);
  const json = await res.json();
  state.beneficiaries.push(json.be);
  if (!state.employees) state.employees = {};
  state.employees[json.be.id] = [];
  closeModal(); renderBEList(); populateCostSelects(); populateEmployeeBESelect();
  document.getElementById('employees-card').style.display = '';
}

async function updateBE(beId) {
  const data = { name:v('be_name'), acronym:v('be_acronym'), country:v('be_country'),
    funding_rate:parseFloat(v('be_funding_rate')), org_type:v('be_org_type'), description:v('be_description') };
  await put(`/api/beneficiary/${beId}`, data);
  const be = state.beneficiaries.find(b => b.id === beId);
  Object.assign(be, data);
  closeModal(); renderBEList(); populateCostSelects(); populateEmployeeBESelect();
}

async function deleteBE(beId) {
  if (!confirm('Supprimer ce bénéficiaire ?')) return;
  await del(`/api/beneficiary/${beId}`);
  state.beneficiaries = state.beneficiaries.filter(b => b.id !== beId);
  renderBEList(); populateCostSelects(); populateEmployeeBESelect();
}

function renderBEList() {
  const tbody = document.getElementById('be-tbody');
  const empty = document.getElementById('be-empty');
  const table = document.getElementById('be-table');
  if (!state.beneficiaries || !state.beneficiaries.length) { empty.style.display=''; table.style.display='none'; return; }
  empty.style.display='none'; table.style.display='';
  tbody.innerHTML = state.beneficiaries.map(be => `
    <tr>
      <td><strong>${be.id}</strong></td><td><small>${be.role}</small></td>
      <td>${be.name||'–'}</td><td>${be.acronym||'–'}</td>
      <td>${be.country||'–'}</td><td>${(be.funding_rate*100).toFixed(0)}%</td>
      <td>${be.org_type||'–'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="showEditBE('${be.id}')">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBE('${be.id}')">🗑️</button>
      </td>
    </tr>`).join('');
}

// ---- EMPLOYEES ----
let localEmployees = [];

function populateEmployeeBESelect() {
  const sel = document.getElementById('emp-be-select');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- Sélectionner un BE --</option>' +
    (state.beneficiaries||[]).map(b => `<option value="${b.id}" ${b.id===cur?'selected':''}>${b.id} – ${b.name||'Sans nom'}</option>`).join('');
  if (cur && state.beneficiaries.find(b=>b.id===cur)) loadEmployeesForBE();
}

async function loadEmployeesForBE() {
  const beId = document.getElementById('emp-be-select').value;
  empCurrentBE = beId;
  if (!beId) { document.getElementById('employees-tbody').innerHTML = '<tr><td colspan="6" class="empty-state">Sélectionnez un bénéficiaire.</td></tr>'; return; }
  localEmployees = (state.employees && state.employees[beId]) ? [...state.employees[beId]] : [];
  renderEmployees();
}

function renderEmployees() {
  const tbody = document.getElementById('employees-tbody');
  if (!localEmployees.length) { tbody.innerHTML='<tr><td colspan="6" class="empty-state">Aucun employé. Cliquez sur « Ajouter un employé ».</td></tr>'; return; }
  tbody.innerHTML = localEmployees.map((e,i) => `
    <tr>
      <td><input type="text" value="${esc(e.last_name||'')}" onchange="localEmployees[${i}].last_name=this.value" placeholder="NOM"></td>
      <td><input type="text" value="${esc(e.first_name||'')}" onchange="localEmployees[${i}].first_name=this.value" placeholder="Prénom"></td>
      <td><select onchange="localEmployees[${i}].profile=this.value">
        ${STAFF_PROFILES.filter(p=>!p.fixed_rate).map(p=>`<option value="${p.id}" ${e.profile===p.id?'selected':''}>${p.label}</option>`).join('')}
      </select></td>
      <td><input type="number" min="0" step="1" value="${e.monthly_salary||''}" onchange="localEmployees[${i}].monthly_salary=parseFloat(this.value)||0" placeholder="Ex: 6500"></td>
      <td><input type="text" value="${esc(e.note||'')}" onchange="localEmployees[${i}].note=this.value" placeholder="Note"></td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteEmployee(${i})">🗑️</button></td>
    </tr>`).join('');
}

function addEmployee() {
  if (!empCurrentBE) { alert('Sélectionnez un bénéficiaire.'); return; }
  localEmployees.push({ id: 'emp_' + Date.now(), last_name:'', first_name:'', profile:'A1_senior', monthly_salary:0, note:'' });
  renderEmployees();
}

function deleteEmployee(i) {
  localEmployees.splice(i, 1);
  renderEmployees();
}

async function saveEmployees() {
  if (!empCurrentBE) return;
  await post(`/api/employees/${empCurrentBE}`, { employees: localEmployees });
  if (!state.employees) state.employees = {};
  state.employees[empCurrentBE] = [...localEmployees];
  showToast('Employés enregistrés ✓');
}

// ---- WORK PACKAGES ----
function showAddWP() { openModal('Ajouter un Work Package', getWPForm(null)); }
function showEditWP(wpId) { openModal('Modifier le WP', getWPForm(state.work_packages.find(w=>w.id===wpId))); }

function getWPForm(wp) {
  const beOpts = (state.beneficiaries||[]).map(b=>`<option value="${b.id}" ${wp&&wp.lead_be===b.id?'selected':''}>${b.id} – ${b.name||''}</option>`).join('');
  const dur = state.project_duration_months || 24;
  return `
    <div class="form-row">
      <div class="form-group"><label>Nom du WP</label><input type="text" id="wp_name" value="${wp?esc(wp.name):''}"></div>
      <div class="form-group"><label>Bénéficiaire Lead</label><select id="wp_lead_be"><option value="">–</option>${beOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Mois de début</label><input type="number" id="wp_start" min="1" max="${dur}" value="${wp?wp.start_month:1}"></div>
      <div class="form-group"><label>Mois de fin</label><input type="number" id="wp_end" min="1" max="${dur}" value="${wp?wp.end_month:dur}"></div>
    </div>
    <div class="form-group"><label>Objectifs</label><textarea id="wp_objectives" rows="3">${wp?esc(wp.objectives||''):''}</textarea></div>
    <div class="form-group"><label>Description des activités</label><textarea id="wp_description" rows="4">${wp?esc(wp.description||''):''}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="${wp?`updateWP('${wp.id}')`:'addWP()'}">${wp?'Mettre à jour':'Ajouter'}</button>
    </div>`;
}

async function addWP() {
  const data = { name:v('wp_name'), lead_be:v('wp_lead_be'),
    start_month:parseInt(v('wp_start'))||1, end_month:parseInt(v('wp_end'))||24,
    objectives:v('wp_objectives'), description:v('wp_description') };
  if (!data.name) return alert('Le nom est requis.');
  const res = await post('/api/workpackage', data);
  const json = await res.json();
  state.work_packages.push(json.wp);
  closeModal(); renderWPList(); populateCostSelects(); renderWPDetailSelect(); renderTimetable();
}

async function updateWP(wpId) {
  const data = { name:v('wp_name'), lead_be:v('wp_lead_be'),
    start_month:parseInt(v('wp_start'))||1, end_month:parseInt(v('wp_end'))||24,
    objectives:v('wp_objectives'), description:v('wp_description') };
  await put(`/api/workpackage/${wpId}`, data);
  const wp = state.work_packages.find(w=>w.id===wpId);
  Object.assign(wp, data);
  closeModal(); renderWPList(); populateCostSelects(); renderWPDetailSelect();
}

async function deleteWP(wpId) {
  if (!confirm('Supprimer ce WP ?')) return;
  await del(`/api/workpackage/${wpId}`);
  state.work_packages = state.work_packages.filter(w=>w.id!==wpId);
  renderWPList(); populateCostSelects(); renderWPDetailSelect();
}

function renderWPList() {
  const tbody=document.getElementById('wp-tbody');
  const empty=document.getElementById('wp-empty');
  const table=document.getElementById('wp-table');
  if (!state.work_packages||!state.work_packages.length){empty.style.display='';table.style.display='none';return;}
  empty.style.display='none'; table.style.display='';
  tbody.innerHTML=state.work_packages.map(wp=>`
    <tr>
      <td><strong>${wp.id}</strong></td><td>${wp.name}</td>
      <td>${wp.lead_be||'–'}</td><td>M${wp.start_month||1}</td><td>M${wp.end_month||'?'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="showEditWP('${wp.id}')">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deleteWP('${wp.id}')">🗑️</button>
      </td>
    </tr>`).join('');
}

function renderWPDetailSelect() {
  const sel=document.getElementById('wp-detail-select');
  if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">-- Sélectionner --</option>'+(state.work_packages||[]).map(w=>`<option value="${w.id}" ${w.id===cur?'selected':''}>${w.id} – ${w.name}</option>`).join('');
  const card=document.getElementById('wp-detail-card');
  if(state.work_packages&&state.work_packages.length) card.style.display=''; else card.style.display='none';
  if(cur && state.work_packages.find(w=>w.id===cur)) loadWPDetail();
}

let wpTasks={}, wpMilestones={}, wpDeliverables={};

function loadWPDetail() {
  const wpId=document.getElementById('wp-detail-select').value;
  const body=document.getElementById('wp-detail-body');
  if(!wpId){body.innerHTML='';return;}
  const wp=state.work_packages.find(w=>w.id===wpId);
  wpTasks[wpId]=state.tasks&&state.tasks[wpId]?[...state.tasks[wpId]]:[];
  wpMilestones[wpId]=state.milestones&&state.milestones[wpId]?[...state.milestones[wpId]]:[];
  wpDeliverables[wpId]=state.deliverables&&state.deliverables[wpId]?[...state.deliverables[wpId]]:[];
  body.innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <div class="section-header"><h2>📋 Tâches – ${wpId}</h2>
        <button class="btn btn-sm btn-primary" onclick="addTask('${wpId}')">+ Tâche</button></div>
      <table class="data-table"><thead><tr><th>N° tâche</th><th>Nom / Description</th><th>Contributeurs & ETP (mois)</th><th>Sous-traitance</th><th></th></tr></thead>
      <tbody id="tasks-tbody-${wpId}"></tbody></table>
      <div style="margin-top:.75rem"><button class="btn btn-sm btn-secondary" onclick="saveTasks('${wpId}')">💾 Enregistrer tâches</button></div>
    </div>
    <div class="card" style="margin-bottom:1rem">
      <div class="section-header"><h2>🏁 Jalons (Milestones) – ${wpId}</h2>
        <button class="btn btn-sm btn-primary" onclick="addMilestone('${wpId}')">+ Jalon</button></div>
      <table class="data-table"><thead><tr><th>N°</th><th>Nom</th><th>Lead</th><th>Description</th><th>Mois</th><th>Vérification</th><th></th></tr></thead>
      <tbody id="milestones-tbody-${wpId}"></tbody></table>
      <div style="margin-top:.75rem"><button class="btn btn-sm btn-secondary" onclick="saveMilestones('${wpId}')">💾 Enregistrer jalons</button></div>
    </div>
    <div class="card">
      <div class="section-header"><h2>📄 Livrables (Deliverables) – ${wpId}</h2>
        <button class="btn btn-sm btn-primary" onclick="addDeliverable('${wpId}')">+ Livrable</button></div>
      <table class="data-table"><thead><tr><th>N°</th><th>Nom</th><th>Lead</th><th>Type</th><th>Diffusion</th><th>Mois</th><th>Description</th><th></th></tr></thead>
      <tbody id="deliverables-tbody-${wpId}"></tbody></table>
      <div style="margin-top:.75rem"><button class="btn btn-sm btn-secondary" onclick="saveDeliverables('${wpId}')">💾 Enregistrer livrables</button></div>
    </div>`;
  renderTasks(wpId); renderMilestones(wpId); renderDeliverables(wpId);
}

function getAllCollaborators() {
  const collab = [];
  (state.beneficiaries||[]).forEach(be => {
    collab.push({ id: `BE_${be.id}`, label: `${be.id} — ${be.name||be.id} (${be.role||'BEN'})`, be_id: be.id, type: 'be', profile: null, monthly_salary: 0 });
    const emps = (state.employees&&state.employees[be.id])||[];
    emps.forEach(emp => {
      const name = [emp.last_name, emp.first_name].filter(Boolean).join(' ') || emp.id;
      collab.push({ id: emp.id, label: `${name} (${be.id})`, be_id: be.id, type: 'emp', profile: emp.profile, monthly_salary: emp.monthly_salary||0 });
    });
  });
  return collab;
}

// Build ETP table for a task: { collabId: months }
function getTaskEtp(task) {
  return task.etp || {};
}

function renderTasks(wpId) {
  const tbody = document.getElementById(`tasks-tbody-${wpId}`);
  if (!tbody) return;
  const tasks = wpTasks[wpId] || [];
  if (!tasks.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Aucune tâche.</td></tr>'; return; }
  const collab = getAllCollaborators();

  tbody.innerHTML = tasks.map((t, i) => {
    const selectedIds = Array.isArray(t.participants_list) ? t.participants_list : [];
    const etp = t.etp || {};

    // Participants + ETP rows inside the cell
    let participantsHtml = `
      <div class="participants-picker" id="pp_${wpId}_${i}">
        <div class="pp-trigger" onclick="togglePPDropdown('${wpId}',${i})">
          ${selectedIds.length
            ? selectedIds.map(id => { const c = collab.find(x => x.id === id); return c ? `<span class="pp-tag">${esc(c.label)}</span>` : ''; }).join('')
            : '<span class="pp-placeholder">Cliquer pour sélectionner…</span>'}
        </div>
        <div class="pp-dropdown" id="ppd_${wpId}_${i}">
          <div class="pp-search-wrap"><input type="text" class="pp-search" placeholder="Rechercher…" oninput="filterPP(this,'ppd_${wpId}_${i}')"></div>
          ${collab.map(c => `
            <label class="pp-item ${c.type==='be'?'pp-item-be':''}" data-label="${esc(c.label)}">
              <input type="checkbox" ${selectedIds.includes(c.id)?'checked':''} onchange="toggleParticipant('${wpId}',${i},'${c.id}',this.checked)">
              <span>${esc(c.label)}</span>
            </label>`).join('')}
          <div class="pp-footer"><button class="btn btn-sm btn-secondary" onclick="closePPDropdown('${wpId}',${i})">✓ Fermer</button></div>
        </div>
      </div>
      ${selectedIds.length ? `
        <div class="etp-grid" id="etp_${wpId}_${i}">
          <div class="etp-header"><span>Contributeur</span><span>ETP (mois)</span></div>
          ${selectedIds.map(id => {
            const c = collab.find(x => x.id === id);
            if (!c) return '';
            const etpVal = etp[id] !== undefined ? etp[id] : '';
            return `<div class="etp-row">
              <span class="etp-name">${esc(c.label)}</span>
              <input type="number" min="0" step="0.1" class="etp-input" value="${etpVal}"
                onchange="setEtp('${wpId}',${i},'${id}',parseFloat(this.value)||0)"
                oninput="setEtp('${wpId}',${i},'${id}',parseFloat(this.value)||0)"
                placeholder="0">
            </div>`;
          }).join('')}
          <div class="etp-total">
            <span>Total ETP :</span>
            <span id="etp_total_${wpId}_${i}">${selectedIds.reduce((s,id)=>s+(parseFloat(etp[id])||0),0).toFixed(1)} mois</span>
          </div>
        </div>` : ''}`;

    return `<tr>
      <td style="white-space:nowrap;vertical-align:top;padding-top:.6rem">
        <input type="text" value="${esc(t.num||'')}" onchange="wpTasks['${wpId}'][${i}].num=this.value" placeholder="T${wpId.replace('WP','')}.${i+1}" style="width:72px">
      </td>
      <td style="vertical-align:top">
        <input type="text" value="${esc(t.name||'')}" onchange="wpTasks['${wpId}'][${i}].name=this.value">
        <textarea rows="2" style="margin-top:.25rem" onchange="wpTasks['${wpId}'][${i}].description=this.value">${esc(t.description||'')}</textarea>
      </td>
      <td style="position:relative;min-width:260px;vertical-align:top">${participantsHtml}</td>
      <td style="vertical-align:top;white-space:nowrap">
        <input type="text" value="${esc(t.subcontracting||'')}" onchange="wpTasks['${wpId}'][${i}].subcontracting=this.value" placeholder="Oui/Non" style="width:80px">
      </td>
      <td style="vertical-align:top"><button class="btn btn-sm btn-danger" onclick="wpTasks['${wpId}'].splice(${i},1);renderTasks('${wpId}')">🗑️</button></td>
    </tr>`;
  }).join('');
}

function setEtp(wpId, taskIdx, collabId, val) {
  const task = (wpTasks[wpId]||[])[taskIdx];
  if (!task) return;
  if (!task.etp) task.etp = {};
  task.etp[collabId] = val;
  // Update total display
  const totalEl = document.getElementById(`etp_total_${wpId}_${taskIdx}`);
  if (totalEl) {
    const sel = task.participants_list || [];
    const total = sel.reduce((s, id) => s + (parseFloat(task.etp[id])||0), 0);
    totalEl.textContent = total.toFixed(1) + ' mois';
  }
}

function addTask(wpId) {
  wpTasks[wpId] = wpTasks[wpId] || [];
  wpTasks[wpId].push({ num:'', name:'', description:'', participants_list:[], etp:{}, subcontracting:'' });
  renderTasks(wpId);
}

function togglePPDropdown(wpId, taskIdx) {
  const dd = document.getElementById(`ppd_${wpId}_${taskIdx}`);
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  document.querySelectorAll('.pp-dropdown').forEach(d => d.classList.remove('open'));
  if (!isOpen) dd.classList.add('open');
}

function closePPDropdown(wpId, taskIdx) {
  const dd = document.getElementById(`ppd_${wpId}_${taskIdx}`);
  if (dd) dd.classList.remove('open');
}

function filterPP(input, dropdownId) {
  const q = input.value.toLowerCase();
  const dd = document.getElementById(dropdownId);
  if (!dd) return;
  dd.querySelectorAll('.pp-item').forEach(item => {
    const lbl = (item.dataset.label||'').toLowerCase();
    item.style.display = lbl.includes(q) ? '' : 'none';
  });
}

function toggleParticipant(wpId, taskIdx, collabId, checked) {
  const task = (wpTasks[wpId]||[])[taskIdx];
  if (!task) return;
  if (!Array.isArray(task.participants_list)) task.participants_list = [];
  if (!task.etp) task.etp = {};
  if (checked && !task.participants_list.includes(collabId)) {
    task.participants_list.push(collabId);
    task.etp[collabId] = task.etp[collabId] || 0;
  } else if (!checked) {
    task.participants_list = task.participants_list.filter(x => x !== collabId);
  }
  renderTasks(wpId);
}

document.addEventListener('click', e => {
  if (!e.target.closest('.participants-picker')) {
    document.querySelectorAll('.pp-dropdown').forEach(d => d.classList.remove('open'));
  }
});

// ---- ETP → BUDGET: compute aggregated ETP per profile per BE×WP ----
function computeEtpForBudget(beId, wpId) {
  // Returns { catId: { total_pm, emp_id, monthly_salary } }
  // Aggregates all tasks across all WPs for this BE×WP pair
  const collab = getAllCollaborators();
  const allTasks = state.tasks || {};
  // Only tasks of this WP
  const tasks = allTasks[wpId] || [];

  // Map: empId → { total_pm }
  const empPM = {};
  tasks.forEach(task => {
    const sel = Array.isArray(task.participants_list) ? task.participants_list : [];
    const etp = task.etp || {};
    sel.forEach(collabId => {
      const c = collab.find(x => x.id === collabId);
      if (!c || c.be_id !== beId) return; // only this BE
      if (c.type !== 'emp') return; // only named employees
      const pm = parseFloat(etp[collabId]) || 0;
      if (!empPM[collabId]) empPM[collabId] = { total_pm: 0, emp: c };
      empPM[collabId].total_pm += pm;
    });
  });

  // Map: catId (A1_senior etc) → { total_pm, best_emp_id, monthly_salary }
  const catAgg = {};
  Object.entries(empPM).forEach(([empId, data]) => {
    const catId = data.emp.profile; // e.g. "A1_senior"
    if (!catId) return;
    if (!catAgg[catId]) catAgg[catId] = { total_pm: 0, emp_ids: [], monthly_salaries: [] };
    catAgg[catId].total_pm += data.total_pm;
    catAgg[catId].emp_ids.push(empId);
    catAgg[catId].monthly_salaries.push(data.emp.monthly_salary || 0);
  });

  // Compute average salary per category
  Object.keys(catAgg).forEach(catId => {
    const salaries = catAgg[catId].monthly_salaries.filter(s => s > 0);
    catAgg[catId].avg_salary = salaries.length ? salaries.reduce((a,b)=>a+b,0)/salaries.length : 0;
  });

  return catAgg;
}

function prefillBudgetFromETP() {
  const beId = document.getElementById('cost-be-select')?.value;
  const wpId = document.getElementById('cost-wp-select')?.value;
  if (!beId || !wpId) { showToast('Sélectionnez un BE et un WP d\'abord.'); return; }

  const agg = computeEtpForBudget(beId, wpId);
  if (!Object.keys(agg).length) {
    showToast('Aucun ETP trouvé pour ce BE×WP. Vérifiez les tâches.'); return;
  }

  let filled = 0;
  Object.entries(agg).forEach(([catId, data]) => {
    const itemsEl = document.getElementById(`i_${catId}_items`);
    const rateEl  = document.getElementById(`i_${catId}_rate`);
    if (itemsEl && data.total_pm > 0) {
      itemsEl.value = data.total_pm.toFixed(1);
      itemsEl.style.background = '#fef9c3'; // highlight
      filled++;
    }
    if (rateEl && data.avg_salary > 0) {
      rateEl.value = data.avg_salary.toFixed(2);
      rateEl.style.background = '#fef9c3';
    }
    updateCostRow(catId);
  });
  showToast(`${filled} ligne(s) pré-remplie(s) depuis les ETP ✓`);
}

async function saveTasks(wpId) {
  await post(`/api/tasks/${wpId}`,{tasks:wpTasks[wpId]||[]});
  if(!state.tasks) state.tasks={};
  state.tasks[wpId]=[...(wpTasks[wpId]||[])];
  showToast('Tâches enregistrées ✓');
}

function renderMilestones(wpId) {
  const tbody=document.getElementById(`milestones-tbody-${wpId}`);
  if(!tbody) return;
  const ms=wpMilestones[wpId]||[];
  if(!ms.length){tbody.innerHTML='<tr><td colspan="7" class="empty-state">Aucun jalon.</td></tr>';return;}
  tbody.innerHTML=ms.map((m,i)=>`<tr>
    <td><input type="text" value="${esc(m.num||`MS${i+1}`)}" onchange="wpMilestones['${wpId}'][${i}].num=this.value"></td>
    <td><input type="text" value="${esc(m.name||'')}" onchange="wpMilestones['${wpId}'][${i}].name=this.value"></td>
    <td><input type="text" value="${esc(m.lead||'')}" onchange="wpMilestones['${wpId}'][${i}].lead=this.value"></td>
    <td><input type="text" value="${esc(m.description||'')}" onchange="wpMilestones['${wpId}'][${i}].description=this.value"></td>
    <td><input type="number" value="${m.due_month||''}" min="1" onchange="wpMilestones['${wpId}'][${i}].due_month=parseInt(this.value)"></td>
    <td><input type="text" value="${esc(m.verification||'')}" onchange="wpMilestones['${wpId}'][${i}].verification=this.value"></td>
    <td><button class="btn btn-sm btn-danger" onclick="wpMilestones['${wpId}'].splice(${i},1);renderMilestones('${wpId}')">🗑️</button></td>
  </tr>`).join('');
}

function addMilestone(wpId) { wpMilestones[wpId]=wpMilestones[wpId]||[]; wpMilestones[wpId].push({num:`MS${wpMilestones[wpId].length+1}`,name:'',lead:'',description:'',due_month:'',verification:''}); renderMilestones(wpId); }

async function saveMilestones(wpId) {
  await post(`/api/milestones/${wpId}`,{milestones:wpMilestones[wpId]||[]});
  if(!state.milestones) state.milestones={};
  state.milestones[wpId]=[...(wpMilestones[wpId]||[])];
  showToast('Jalons enregistrés ✓');
}

const DELIVERABLE_TYPES=['R — Document, report','DEM — Demonstrator, pilot, prototype','DEC — Websites, patent, videos','DATA — data sets','DMP — Data Management Plan','ETHICS','SECURITY','OTHER'];
const DISSEMINATION_LEVELS=['PU — Public','SEN — Sensitive','R-UE/EU-R — EU Classified'];

function renderDeliverables(wpId) {
  const tbody=document.getElementById(`deliverables-tbody-${wpId}`);
  if(!tbody) return;
  const ds=wpDeliverables[wpId]||[];
  if(!ds.length){tbody.innerHTML='<tr><td colspan="8" class="empty-state">Aucun livrable.</td></tr>';return;}
  const typeOpts=DELIVERABLE_TYPES.map(t=>`<option>${t}</option>`).join('');
  const dissOpts=DISSEMINATION_LEVELS.map(d=>`<option>${d}</option>`).join('');
  tbody.innerHTML=ds.map((d,i)=>`<tr>
    <td><input type="text" value="${esc(d.num||`D${i+1}`)}" onchange="wpDeliverables['${wpId}'][${i}].num=this.value"></td>
    <td><input type="text" value="${esc(d.name||'')}" onchange="wpDeliverables['${wpId}'][${i}].name=this.value"></td>
    <td><input type="text" value="${esc(d.lead||'')}" onchange="wpDeliverables['${wpId}'][${i}].lead=this.value"></td>
    <td><select onchange="wpDeliverables['${wpId}'][${i}].type=this.value">${DELIVERABLE_TYPES.map(t=>`<option ${d.type===t?'selected':''}>${t}</option>`).join('')}</select></td>
    <td><select onchange="wpDeliverables['${wpId}'][${i}].dissemination=this.value">${DISSEMINATION_LEVELS.map(dl=>`<option ${d.dissemination===dl?'selected':''}>${dl}</option>`).join('')}</select></td>
    <td><input type="number" value="${d.due_month||''}" min="1" onchange="wpDeliverables['${wpId}'][${i}].due_month=parseInt(this.value)"></td>
    <td><textarea rows="2" onchange="wpDeliverables['${wpId}'][${i}].description=this.value">${esc(d.description||'')}</textarea></td>
    <td><button class="btn btn-sm btn-danger" onclick="wpDeliverables['${wpId}'].splice(${i},1);renderDeliverables('${wpId}')">🗑️</button></td>
  </tr>`).join('');
}

function addDeliverable(wpId) { wpDeliverables[wpId]=wpDeliverables[wpId]||[]; wpDeliverables[wpId].push({num:`D${wpDeliverables[wpId].length+1}`,name:'',lead:'',type:'R — Document, report',dissemination:'PU — Public',due_month:'',description:''}); renderDeliverables(wpId); }

async function saveDeliverables(wpId) {
  await post(`/api/deliverables/${wpId}`,{deliverables:wpDeliverables[wpId]||[]});
  if(!state.deliverables) state.deliverables={};
  state.deliverables[wpId]=[...(wpDeliverables[wpId]||[])];
  showToast('Livrables enregistrés ✓');
}

// ---- COSTS ----
function populateCostSelects() {
  const beSel=document.getElementById('cost-be-select');
  const wpSel=document.getElementById('cost-wp-select');
  if(!beSel||!wpSel) return;
  const beV=beSel.value, wpV=wpSel.value;
  beSel.innerHTML='<option value="">-- Sélectionner --</option>'+(state.beneficiaries||[]).map(b=>`<option value="${b.id}" ${b.id===beV?'selected':''}>${b.id} – ${b.name||'Sans nom'}</option>`).join('');
  wpSel.innerHTML='<option value="">-- Sélectionner --</option>'+(state.work_packages||[]).map(w=>`<option value="${w.id}" ${w.id===wpV?'selected':''}>${w.id} – ${w.name}</option>`).join('');
}

function getEtpSummaryHtml(beId, wpId) {
  const agg = computeEtpForBudget(beId, wpId);
  if (!Object.keys(agg).length) return '';
  const collab = getAllCollaborators();
  const allTasks = state.tasks || {};
  const tasks = allTasks[wpId] || [];

  // Build per-employee detail
  const empPM = {};
  tasks.forEach(task => {
    const sel = Array.isArray(task.participants_list) ? task.participants_list : [];
    const etp = task.etp || {};
    sel.forEach(cid => {
      const c = collab.find(x => x.id === cid);
      if (!c || c.be_id !== beId || c.type !== 'emp') return;
      const pm = parseFloat(etp[cid]) || 0;
      if (!empPM[cid]) empPM[cid] = { label: c.label, total_pm: 0, salary: c.monthly_salary||0 };
      empPM[cid].total_pm += pm;
    });
  });

  const rows = Object.values(empPM).filter(e => e.total_pm > 0).map(e =>
    `<div class="etp-sum-row">
      <span>${esc(e.label)}</span>
      <span><strong>${e.total_pm.toFixed(1)}</strong> mois</span>
      <span>${e.salary > 0 ? fmt(e.total_pm * e.salary) : '–'}</span>
    </div>`
  ).join('');

  return rows ? `<div class="etp-summary-box">
    <div class="etp-sum-title">📊 ETP saisis dans les tâches de ce WP pour ${beId}</div>
    <div class="etp-sum-header"><span>Contributeur</span><span>Mois-personne</span><span>Coût estimé</span></div>
    ${rows}
  </div>` : '';
}

function loadCostForm() {
  const beId=document.getElementById('cost-be-select').value;
  const wpId=document.getElementById('cost-wp-select').value;
  const container=document.getElementById('cost-form-container');
  if(!beId||!wpId){container.innerHTML='';return;}
  const key=`${beId}__${wpId}`;
  const saved=state.costs&&state.costs[key]?state.costs[key]:{};
  const be=state.beneficiaries.find(b=>b.id===beId);
  const wp=state.work_packages.find(w=>w.id===wpId);
  const emps=(state.employees&&state.employees[beId])||[];

  const sections=[
    {id:'A',label:'A. Coûts directs de personnel',cats:COST_CATEGORIES.filter(c=>c.section==='A')},
    {id:'B',label:'B. Coûts directs de sous-traitance',cats:COST_CATEGORIES.filter(c=>c.section==='B')},
    {id:'C',label:'C. Coûts directs d\'achats',cats:COST_CATEGORIES.filter(c=>c.section==='C')},
    {id:'D',label:'D. Autres catégories de coûts directs',cats:COST_CATEGORIES.filter(c=>c.section==='D')},
  ];

  let html=`<div style="margin-bottom:1rem;padding:.75rem 1rem;background:#eff6ff;border-radius:6px;display:flex;gap:1rem;flex-wrap:wrap;align-items:center;justify-content:space-between">
    <div><span><strong>${beId}</strong> – ${be?be.name:''}</span> &nbsp;|&nbsp; <span><strong>${wpId}</strong> – ${wp?wp.name:''}</span></div>
    <button class="btn btn-gold" onclick="prefillBudgetFromETP()" title="Agrège les ETP saisis dans les tâches de ce WP et pré-remplit les lignes de personnel">
      ⚡ Pré-remplir depuis les ETP des tâches
    </button>
  </div>
  ${getEtpSummaryHtml(beId, wpId)}`;

  sections.forEach(sec=>{
    html+=`<div class="cost-section">
      <div class="cost-section-header">${sec.label}</div>
      <div class="cost-section-body">
        <div class="cost-row cost-row-header">
          <div class="cost-cell">Catégorie</div>
          <div class="cost-cell" style="text-align:right">Nb items / mois</div>
          <div class="cost-cell" style="text-align:right">Employé (optionnel)</div>
          <div class="cost-cell" style="text-align:right">Coût/item (€)</div>
          <div class="cost-cell" style="text-align:right">Total (€)</div>
        </div>`;
    sec.cats.forEach(cat=>{
      const items=saved[`${cat.id}_items`]||'';
      const empRef=saved[`${cat.id}_emp_ref`]||'';
      const rate=cat.fixed_rate?SME_RATE:(saved[`${cat.id}_rate`]||'');
      const isPersonnel=cat.section==='A'&&!cat.fixed_rate;
      const empOpts=isPersonnel?`<select id="i_${cat.id}_emp" onchange="onEmpChange('${cat.id}')">
        <option value="">– saisir manuellement –</option>
        ${emps.map(e=>`<option value="${e.id}" ${empRef===e.id?'selected':''}>${e.last_name||''} ${e.first_name||''} (${fmt(e.monthly_salary)}€/m)</option>`).join('')}
      </select>`:'<span style="color:var(--text-muted);font-size:.8rem">–</span>';
      const total=items&&rate?fmt(parseFloat(items)*parseFloat(rate)):'–';
      html+=`<div class="cost-row" id="crow_${cat.id}">
        <div class="cost-cell"><small>${cat.label}</small></div>
        <div class="cost-cell"><input type="number" min="0" step="0.1" id="i_${cat.id}_items" value="${items}" placeholder="0" oninput="updateCostRow('${cat.id}')"></div>
        <div class="cost-cell">${empOpts}</div>
        <div class="cost-cell"><input type="number" min="0" step="0.01" id="i_${cat.id}_rate" value="${rate}" placeholder="${cat.fixed_rate?SME_RATE+' (fixe)':'0'}" ${cat.fixed_rate?'disabled':''} oninput="updateCostRow('${cat.id}')"></div>
        <div class="cost-total-cell" id="t_${cat.id}">${total}</div>
      </div>`;
    });
    html+=`</div></div>`;
  });

  html+=`<div style="text-align:right;margin-top:1rem">
    <button class="btn btn-success" onclick="saveCosts('${beId}','${wpId}')">💾 Enregistrer les coûts</button>
  </div>`;
  container.innerHTML=html;

  // Apply emp refs on load
  if(emps.length) {
    COST_CATEGORIES.filter(c=>c.section==='A'&&!c.fixed_rate).forEach(cat=>{
      const empRef=saved[`${cat.id}_emp_ref`]||'';
      if(empRef) {
        const sel=document.getElementById(`i_${cat.id}_emp`);
        if(sel) sel.value=empRef;
      }
    });
  }
}

function onEmpChange(catId) {
  const sel=document.getElementById(`i_${catId}_emp`);
  if(!sel) return;
  const empId=sel.value;
  const beId=document.getElementById('cost-be-select').value;
  const emps=(state.employees&&state.employees[beId])||[];
  const emp=emps.find(e=>e.id===empId);
  const rateEl=document.getElementById(`i_${catId}_rate`);
  if(emp&&rateEl) { rateEl.value=emp.monthly_salary; updateCostRow(catId); }
  else if(!empId&&rateEl) { rateEl.value=''; updateCostRow(catId); }
}

function updateCostRow(catId) {
  const items=parseFloat(document.getElementById(`i_${catId}_items`)?.value)||0;
  const cat=COST_CATEGORIES.find(c=>c.id===catId);
  const rate=cat.fixed_rate?SME_RATE:(parseFloat(document.getElementById(`i_${catId}_rate`)?.value)||0);
  const el=document.getElementById(`t_${catId}`);
  if(el) el.textContent=items&&rate?fmt(items*rate):'–';
}

async function saveCosts(beId,wpId) {
  const costs={};
  COST_CATEGORIES.forEach(cat=>{
    const iEl=document.getElementById(`i_${cat.id}_items`);
    const rEl=document.getElementById(`i_${cat.id}_rate`);
    const eEl=document.getElementById(`i_${cat.id}_emp`);
    if(iEl) costs[`${cat.id}_items`]=iEl.value;
    if(rEl&&!cat.fixed_rate) costs[`${cat.id}_rate`]=rEl.value;
    if(eEl) costs[`${cat.id}_emp_ref`]=eEl.value;
  });
  await post('/api/costs',{be_id:beId,wp_id:wpId,costs});
  if(!state.costs) state.costs={};
  state.costs[`${beId}__${wpId}`]=costs;
  showToast('Coûts enregistrés ✓');
}

// ---- RISKS ----
let localRisks=[];
function renderRisks(){
  const pb=state.part_b||{};
  localRisks=[...(pb.risks||[])];
  _renderRisksTable();
}
function _renderRisksTable(){
  const tbody=document.getElementById('risks-tbody');
  if(!tbody) return;
  if(!localRisks.length){tbody.innerHTML='<tr><td colspan="7" class="empty-state">Aucun risque.</td></tr>';return;}
  const wpOpts=(state.work_packages||[]).map(w=>`<option value="${w.id}">${w.id}</option>`).join('');
  tbody.innerHTML=localRisks.map((r,i)=>`<tr>
    <td>${i+1}</td>
    <td><textarea rows="2" onchange="localRisks[${i}].description=this.value">${esc(r.description||'')}</textarea></td>
    <td><select onchange="localRisks[${i}].wp=this.value"><option value="">–</option>${wpOpts}</select></td>
    <td><textarea rows="2" onchange="localRisks[${i}].mitigation=this.value">${esc(r.mitigation||'')}</textarea></td>
    <td><select onchange="localRisks[${i}].impact=this.value">
      ${['Faible','Moyen','Élevé'].map(l=>`<option ${r.impact===l?'selected':''}>${l}</option>`).join('')}
    </select></td>
    <td><select onchange="localRisks[${i}].probability=this.value">
      ${['Faible','Moyenne','Élevée'].map(l=>`<option ${r.probability===l?'selected':''}>${l}</option>`).join('')}
    </select></td>
    <td><button class="btn btn-sm btn-danger" onclick="localRisks.splice(${i},1);_renderRisksTable();saveRisks()">🗑️</button></td>
  </tr>`).join('');
}
function addRisk(){localRisks.push({description:'',wp:'',mitigation:'',impact:'Moyen',probability:'Moyenne'});_renderRisksTable();}
async function saveRisks(){
  await post('/api/part_b',{risks:localRisks});
  if(!state.part_b) state.part_b={};
  state.part_b.risks=[...localRisks];
}

// ---- STAFF TABLE ----
let localStaff=[];
function renderStaffTable(){
  const pb=state.part_b||{};
  localStaff=[...(pb.staff_table||[])];
  _renderStaff();
}
function _renderStaff(){
  const tbody=document.getElementById('staff-tbody');
  if(!tbody) return;
  if(!localStaff.length){tbody.innerHTML='<tr><td colspan="4" class="empty-state">Aucun membre.</td></tr>';return;}
  tbody.innerHTML=localStaff.map((s,i)=>`<tr>
    <td><input type="text" value="${esc(s.name_function||'')}" onchange="localStaff[${i}].name_function=this.value" placeholder="Prénom NOM – Fonction"></td>
    <td><input type="text" value="${esc(s.organisation||'')}" onchange="localStaff[${i}].organisation=this.value"></td>
    <td><textarea rows="2" onchange="localStaff[${i}].role=this.value">${esc(s.role||'')}</textarea></td>
    <td><button class="btn btn-sm btn-danger" onclick="localStaff.splice(${i},1);_renderStaff();saveStaff()">🗑️</button></td>
  </tr>`).join('');
}
function addStaffRow(){localStaff.push({name_function:'',organisation:'',role:''});_renderStaff();}
async function saveStaff(){
  await post('/api/part_b',{staff_table:localStaff});
  if(!state.part_b) state.part_b={};
  state.part_b.staff_table=[...localStaff];
}

// ---- SUBCONTRACTING ----
let localSubcontracting=[];
function renderSubcontracting(){
  localSubcontracting=[...(state.subcontracting||[])];
  _renderSubTable();
}
function _renderSubTable(){
  const tbody=document.getElementById('subcontracting-tbody');
  if(!tbody) return;
  if(!localSubcontracting.length){tbody.innerHTML='<tr><td colspan="8" class="empty-state">Aucune sous-traitance.</td></tr>';return;}
  const wpOpts=(state.work_packages||[]).map(w=>`<option value="${w.id}">${w.id}</option>`).join('');
  tbody.innerHTML=localSubcontracting.map((s,i)=>`<tr>
    <td><select onchange="localSubcontracting[${i}].wp=this.value"><option>–</option>${wpOpts}</select></td>
    <td><input type="text" value="${esc(s.num||`S${i+1}`)}" onchange="localSubcontracting[${i}].num=this.value"></td>
    <td><input type="text" value="${esc(s.name||'')}" onchange="localSubcontracting[${i}].name=this.value"></td>
    <td><textarea rows="2" onchange="localSubcontracting[${i}].description=this.value">${esc(s.description||'')}</textarea></td>
    <td><input type="number" value="${s.cost||''}" onchange="localSubcontracting[${i}].cost=parseFloat(this.value)"></td>
    <td><textarea rows="2" onchange="localSubcontracting[${i}].justification=this.value">${esc(s.justification||'')}</textarea></td>
    <td><textarea rows="2" onchange="localSubcontracting[${i}].best_value=this.value">${esc(s.best_value||'')}</textarea></td>
    <td><button class="btn btn-sm btn-danger" onclick="localSubcontracting.splice(${i},1);_renderSubTable()">🗑️</button></td>
  </tr>`).join('');
}
function addSubcontract(){localSubcontracting.push({wp:'',num:'',name:'',description:'',cost:'',justification:'',best_value:''});_renderSubTable();}
async function saveSubcontracting(){
  await post('/api/subcontracting',{items:localSubcontracting});
  state.subcontracting=[...localSubcontracting];
  showToast('Sous-traitance enregistrée ✓');
}

// ---- GANTT INTERACTIF ----
let ganttDrag = { active: false, taskKey: null, startMonth: null, painting: null };

function populateGanttWPSelect() {
  const sel = document.getElementById('gantt-wp-select');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tous les WP</option>' +
    (state.work_packages||[]).map(w => `<option value="${w.id}" ${w.id===cur?'selected':''}>${w.id} – ${w.name}</option>`).join('');
}

function renderGantt() {
  populateGanttWPSelect();
  const container = document.getElementById('gantt-container');
  if (!container) return;
  const dur = parseInt(state.project_duration_months) || 24;
  const months = Array.from({length: dur}, (_, i) => i + 1);
  const filterWP = document.getElementById('gantt-wp-select')?.value || '';

  // Collect all tasks from all WPs (or filtered WP)
  const allTaskRows = [];
  (state.work_packages||[]).forEach(wp => {
    if (filterWP && wp.id !== filterWP) return;
    const tasks = (state.tasks && state.tasks[wp.id]) || [];
    if (!tasks.length) {
      // Show WP row even if no tasks
      allTaskRows.push({ wpId: wp.id, wpName: wp.name, taskIdx: null, task: null,
        key: `${wp.id}__empty`, isWPHeader: true });
      return;
    }
    tasks.forEach((task, ti) => {
      allTaskRows.push({ wpId: wp.id, wpName: wp.name, taskIdx: ti, task,
        key: `${wp.id}__${ti}`, isWPHeader: false });
    });
  });

  if (!allTaskRows.length) {
    container.innerHTML = '<div class="empty-state">Ajoutez des WP et des tâches pour afficher le Gantt.</div>';
    return;
  }

  // Year/quarter header
  const yearGroups = [];
  let y = 1, m = 0;
  months.forEach(mo => {
    m++;
    if (m === 1 || mo === 1) yearGroups.push({ label: `Année ${y}`, count: 0 });
    yearGroups[yearGroups.length-1].count++;
    if (m === 12) { y++; m = 0; }
  });

  let html = `<div class="gantt-wrap">
  <table class="gantt-table" id="gantt-table" onmouseup="ganttMouseUp()" onmouseleave="ganttMouseUp()">
    <thead>
      <tr class="gantt-year-row">
        <th class="gantt-task-col" rowspan="2">WP / Tâche</th>
        <th class="gantt-info-col" rowspan="2">Contributeurs</th>
        <th class="gantt-dur-col" rowspan="2">Durée<br>(mois)</th>
        ${yearGroups.map(g => `<th colspan="${g.count}" class="gantt-year-th">${g.label}</th>`).join('')}
      </tr>
      <tr class="gantt-month-row">
        ${months.map(m => `<th class="gantt-month-th">M${m}</th>`).join('')}
      </tr>
    </thead>
    <tbody>`;

  allTaskRows.forEach(row => {
    if (row.isWPHeader) {
      html += `<tr class="gantt-wp-header-row">
        <td colspan="${months.length + 3}" class="gantt-wp-label">📦 ${row.wpId} — ${row.wpName} <span style="opacity:.6;font-weight:400">(aucune tâche)</span></td>
      </tr>`;
      return;
    }
    const { wpId, wpName, taskIdx, task, key } = row;
    const activeMonths = (task.months || []);
    const durMonths = activeMonths.length;
    const collab = getAllCollaborators();
    const participants = (task.participants_list||[]).map(id => {
      const c = collab.find(x => x.id === id);
      const etp = task.etp?.[id] || 0;
      return c ? `<span class="gantt-contrib">${esc(c.label.split('(')[0].trim())} <em>${etp}/m</em></span>` : '';
    }).join('');

    // Is this the first task of this WP? Add WP header row before
    const isFirstTask = taskIdx === 0;
    let rowHtml = '';
    if (isFirstTask) {
      rowHtml += `<tr class="gantt-wp-header-row">
        <td colspan="${months.length + 3}" class="gantt-wp-label">📦 ${wpId} — ${wpName}</td>
      </tr>`;
    }
    rowHtml += `<tr class="gantt-task-row" data-key="${key}">
      <td class="gantt-task-name">${esc(task.num||'')} ${esc(task.name||'')}</td>
      <td class="gantt-contrib-cell">${participants || '<span style="color:var(--text-muted);font-size:.75rem">–</span>'}</td>
      <td class="gantt-dur-cell" id="gdur_${key}">${durMonths > 0 ? `<strong>${durMonths}</strong>` : '–'}</td>
      ${months.map(m => {
        const active = activeMonths.includes(m);
        const wp = state.work_packages.find(w => w.id === wpId);
        const inWP = wp ? (m >= (wp.start_month||1) && m <= (wp.end_month||dur)) : true;
        return `<td class="gantt-cell ${active ? 'gantt-active' : ''} ${inWP ? '' : 'gantt-out-of-wp'}"
          data-key="${key}" data-month="${m}" data-wpid="${wpId}" data-tidx="${taskIdx}"
          onmousedown="ganttMouseDown('${key}','${wpId}',${taskIdx},${m},event)"
          onmouseenter="ganttMouseEnter('${key}','${wpId}',${taskIdx},${m})">
        </td>`;
      }).join('')}
    </tr>`;
    html += rowHtml;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
  renderGanttEtpSummary();
}

function ganttMouseDown(key, wpId, taskIdx, month, event) {
  event.preventDefault();
  const task = wpTasks[wpId]?.[taskIdx] || (state.tasks?.[wpId]?.[taskIdx]);
  if (!task) return;
  if (!wpTasks[wpId]) wpTasks[wpId] = JSON.parse(JSON.stringify(state.tasks?.[wpId] || []));
  const t = wpTasks[wpId][taskIdx];
  if (!t.months) t.months = [];
  const currentlyActive = t.months.includes(month);
  ganttDrag = { active: true, key, wpId, taskIdx, startMonth: month, painting: !currentlyActive };
  ganttToggleMonth(wpId, taskIdx, month, !currentlyActive);
}

function ganttMouseEnter(key, wpId, taskIdx, month) {
  if (!ganttDrag.active) return;
  if (ganttDrag.wpId !== wpId || ganttDrag.taskIdx !== taskIdx) return;
  ganttToggleMonth(wpId, taskIdx, month, ganttDrag.painting);
}

function ganttMouseUp() {
  if (ganttDrag.active) {
    ganttDrag.active = false;
    renderGanttEtpSummary();
  }
}

function ganttToggleMonth(wpId, taskIdx, month, active) {
  if (!wpTasks[wpId]) wpTasks[wpId] = JSON.parse(JSON.stringify(state.tasks?.[wpId] || []));
  const t = wpTasks[wpId][taskIdx];
  if (!t) return;
  if (!t.months) t.months = [];
  if (active && !t.months.includes(month)) t.months.push(month);
  else if (!active) t.months = t.months.filter(x => x !== month);

  // Update DOM cell directly (no full re-render for performance)
  const key = `${wpId}__${taskIdx}`;
  const cell = document.querySelector(`.gantt-cell[data-key="${key}"][data-month="${month}"]`);
  if (cell) cell.className = `gantt-cell ${active ? 'gantt-active' : ''} ${cell.className.includes('gantt-out-of-wp') ? 'gantt-out-of-wp' : ''}`.trim();
  // Update duration cell
  const durEl = document.getElementById(`gdur_${key}`);
  if (durEl) {
    const n = t.months.length;
    durEl.innerHTML = n > 0 ? `<strong>${n}</strong>` : '–';
  }
}

function renderGanttEtpSummary() {
  const el = document.getElementById('gantt-etp-summary');
  if (!el) return;
  const collab = getAllCollaborators();

  // Aggregate: per BE × WP → per empId → total person-months from months
  // Person-months = etp_monthly_rate × months_active
  const summary = {}; // key: beId__wpId → { catId → { pm, salary, emp_ids } }

  (state.work_packages||[]).forEach(wp => {
    const tasks = wpTasks[wp.id] || state.tasks?.[wp.id] || [];
    tasks.forEach(task => {
      const dur = (task.months||[]).length;
      if (!dur) return;
      (task.participants_list||[]).forEach(collabId => {
        const c = collab.find(x => x.id === collabId);
        if (!c || c.type !== 'emp') return;
        const etpRate = parseFloat(task.etp?.[collabId]) || 0; // person-months per month of task
        if (!etpRate) return;
        const pm = etpRate * dur; // total person-months for this task
        const beId = c.be_id;
        const k = `${beId}__${wp.id}`;
        if (!summary[k]) summary[k] = {};
        const catId = c.profile;
        if (!catId) return;
        if (!summary[k][catId]) summary[k][catId] = { pm: 0, salary: c.monthly_salary||0, emp_count: 0 };
        summary[k][catId].pm += pm;
        summary[k][catId].emp_count++;
      });
    });
  });

  if (!Object.keys(summary).length) { el.innerHTML = ''; return; }

  let html = '<div class="gantt-etp-summary"><div class="gantt-sum-title">📊 ETP calculés depuis le Gantt</div>';
  Object.entries(summary).forEach(([k, cats]) => {
    const [beId, wpId] = k.split('__');
    const be = (state.beneficiaries||[]).find(b => b.id === beId);
    const wp = (state.work_packages||[]).find(w => w.id === wpId);
    const totalPM = Object.values(cats).reduce((s, v) => s + v.pm, 0);
    const totalCost = Object.values(cats).reduce((s, v) => s + v.pm * v.salary, 0);
    html += `<div class="gantt-sum-block">
      <div class="gantt-sum-be">${beId} – ${be?.name||''} &nbsp;×&nbsp; ${wpId} – ${wp?.name||''}</div>
      <div class="gantt-sum-rows">
        <div class="gantt-sum-header"><span>Profil</span><span>Person-mois</span><span>Coût estimé</span></div>
        ${Object.entries(cats).map(([catId, data]) => {
          const prof = STAFF_PROFILES.find(p => p.id === catId);
          return `<div class="gantt-sum-row">
            <span>${prof?.label||catId}</span>
            <span><strong>${data.pm.toFixed(1)}</strong> mois</span>
            <span>${data.salary > 0 ? fmt(data.pm * data.salary) : '–'}</span>
          </div>`;
        }).join('')}
        <div class="gantt-sum-total"><span>Total</span><span>${totalPM.toFixed(1)} mois</span><span>${fmt(totalCost)}</span></div>
      </div>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

function applyGanttToEtp() {
  // For each WP × task, compute person-months from months × etp_rate, store back into task.etp
  // Then sync tasks to state and update cost forms
  const collab = getAllCollaborators();
  let updated = 0;

  (state.work_packages||[]).forEach(wp => {
    const tasks = wpTasks[wp.id] || (state.tasks?.[wp.id] ? JSON.parse(JSON.stringify(state.tasks[wp.id])) : []);
    if (!wpTasks[wp.id]) wpTasks[wp.id] = tasks;
    tasks.forEach((task, ti) => {
      const dur = (task.months||[]).length;
      (task.participants_list||[]).forEach(collabId => {
        const c = collab.find(x => x.id === collabId);
        if (!c || c.type !== 'emp') return;
        const etpRate = parseFloat(task.etp?.[collabId]) || 0;
        // Keep monthly etp rate as-is; the duration drives total PM
        // We just ensure ETP is set
        if (!task.etp) task.etp = {};
      });
    });
    // Save tasks back to state
    if (!state.tasks) state.tasks = {};
    state.tasks[wp.id] = JSON.parse(JSON.stringify(tasks));
  });

  // Now auto-compute aggregated costs for all BE × WP combinations
  autoApplyEtpToCosts();
  renderGanttEtpSummary();
  showToast('ETP recalculés depuis le Gantt et budget mis à jour ✓');
}

function autoApplyEtpToCosts() {
  // Aggregate person-months from Gantt (months × etp_rate) per BE × WP × profile
  const collab = getAllCollaborators();
  if (!state.costs) state.costs = {};

  (state.beneficiaries||[]).forEach(be => {
    (state.work_packages||[]).forEach(wp => {
      const tasks = wpTasks[wp.id] || state.tasks?.[wp.id] || [];
      const catPM = {}; // catId → { totalPM, salaries }

      tasks.forEach(task => {
        const dur = (task.months||[]).length;
        if (!dur) return;
        (task.participants_list||[]).forEach(collabId => {
          const c = collab.find(x => x.id === collabId);
          if (!c || c.type !== 'emp' || c.be_id !== be.id) return;
          const etpRate = parseFloat(task.etp?.[collabId]) || 0;
          const pm = etpRate * dur;
          if (!pm) return;
          const catId = c.profile;
          if (!catId) return;
          if (!catPM[catId]) catPM[catId] = { totalPM: 0, salaries: [] };
          catPM[catId].totalPM += pm;
          if (c.monthly_salary) catPM[catId].salaries.push(c.monthly_salary);
        });
      });

      if (!Object.keys(catPM).length) return;
      const key = `${be.id}__${wp.id}`;
      if (!state.costs[key]) state.costs[key] = {};
      Object.entries(catPM).forEach(([catId, data]) => {
        state.costs[key][`${catId}_items`] = data.totalPM.toFixed(1);
        if (data.salaries.length) {
          const avg = data.salaries.reduce((a,b)=>a+b,0) / data.salaries.length;
          state.costs[key][`${catId}_rate`] = avg.toFixed(2);
        }
      });
      // Push to server
      post('/api/costs', { be_id: be.id, wp_id: wp.id, costs: state.costs[key] });
    });
  });

  // If cost form is open, refresh it
  const beId = document.getElementById('cost-be-select')?.value;
  const wpId = document.getElementById('cost-wp-select')?.value;
  if (beId && wpId) loadCostForm();
}

async function saveGantt() {
  // Save all wpTasks back
  const saves = [];
  for (const [wpId, tasks] of Object.entries(wpTasks)) {
    saves.push(post(`/api/tasks/${wpId}`, {tasks}).then(() => {
      if (!state.tasks) state.tasks = {};
      state.tasks[wpId] = JSON.parse(JSON.stringify(tasks));
    }));
  }
  await Promise.all(saves);
  showToast('Gantt enregistré ✓');
}

// Legacy timetable wrappers (kept for compatibility)
let localTimetable = [];
function renderTimetable() { populateGanttWPSelect(); renderGantt(); }
function addTimetableTask() { showToast('Ajoutez des tâches depuis l\'onglet Work Packages.'); }
async function saveTimetable() { await saveGantt(); }

// ---- PREVIOUS PROJECTS ----
let localPrevProjects=[];
function renderPreviousProjects(){
  const pb=state.part_b||{};
  localPrevProjects=[...(pb.previous_projects||[])];
  _renderPrevProjects();
}
function _renderPrevProjects(){
  const tbody=document.getElementById('prev-projects-tbody');
  if(!tbody) return;
  if(!localPrevProjects.length){tbody.innerHTML='<tr><td colspan="7" class="empty-state">Aucun projet précédent.</td></tr>';return;}
  tbody.innerHTML=localPrevProjects.map((p,i)=>`<tr>
    <td><input type="text" value="${esc(p.participant||'')}" onchange="localPrevProjects[${i}].participant=this.value"></td>
    <td><input type="text" value="${esc(p.reference||'')}" onchange="localPrevProjects[${i}].reference=this.value"></td>
    <td><input type="text" value="${esc(p.period||'')}" onchange="localPrevProjects[${i}].period=this.value" placeholder="MM/YYYY – MM/YYYY"></td>
    <td><select onchange="localPrevProjects[${i}].role=this.value">${['COO','BEN','AE','OTHER'].map(r=>`<option ${p.role===r?'selected':''}>${r}</option>`).join('')}</select></td>
    <td><input type="number" value="${p.amount||''}" onchange="localPrevProjects[${i}].amount=parseFloat(this.value)"></td>
    <td><input type="text" value="${esc(p.website||'')}" onchange="localPrevProjects[${i}].website=this.value" placeholder="https://..."></td>
    <td><button class="btn btn-sm btn-danger" onclick="localPrevProjects.splice(${i},1);_renderPrevProjects()">🗑️</button></td>
  </tr>`).join('');
}
function addPreviousProject(){localPrevProjects.push({participant:'',reference:'',period:'',role:'BEN',amount:'',website:''});_renderPrevProjects();}
async function savePreviousProjects(){
  await post('/api/part_b',{previous_projects:localPrevProjects});
  if(!state.part_b) state.part_b={};
  state.part_b.previous_projects=[...localPrevProjects];
  showToast('Projets précédents enregistrés ✓');
}

// ---- DEPRECIATION ----
let localDeprec=[];
function renderDepreciation(){
  localDeprec=[...(state.depreciation||[])];
  _renderDeprecTable();
}
function _renderDeprecTable(){
  const tbody=document.getElementById('depreciation-tbody');
  if(!tbody) return;
  if(!localDeprec.length){tbody.innerHTML='<tr><td colspan="11" class="empty-state">Aucun équipement.</td></tr>';return;}
  const beOpts=(state.beneficiaries||[]).map(b=>`<option value="${b.id}">${b.id}</option>`).join('');
  const wpOpts=(state.work_packages||[]).map(w=>`<option value="${w.id}">${w.id}</option>`).join('');
  tbody.innerHTML=localDeprec.map((item,i)=>{
    const cost=parseFloat(item.purchase_cost||0);
    const pp=parseFloat(item.pct_project||0);
    const pl=parseFloat(item.pct_life||0);
    const charged=cost*(pp/100)*(pl/100);
    return `<tr>
      <td><select onchange="localDeprec[${i}].be=this.value"><option>–</option>${beOpts}</select></td>
      <td><select onchange="localDeprec[${i}].wp=this.value"><option>–</option>${wpOpts}</select></td>
      <td><input type="text" value="${esc(item.resource_type||'')}" onchange="localDeprec[${i}].resource_type=this.value"></td>
      <td><input type="text" value="${esc(item.description||'')}" onchange="localDeprec[${i}].description=this.value"></td>
      <td><input type="date" value="${item.purchase_date||''}" onchange="localDeprec[${i}].purchase_date=this.value"></td>
      <td><input type="number" min="0" value="${item.purchase_cost||''}" onchange="localDeprec[${i}].purchase_cost=this.value;calcDeprec(${i})" placeholder="0"></td>
      <td><input type="number" min="0" max="100" value="${item.pct_project||''}" onchange="localDeprec[${i}].pct_project=this.value;calcDeprec(${i})" placeholder="100"></td>
      <td><input type="number" min="0" max="100" value="${item.pct_life||''}" onchange="localDeprec[${i}].pct_life=this.value;calcDeprec(${i})" placeholder="50"></td>
      <td id="dep_charged_${i}" style="text-align:right;font-weight:700;color:var(--blue)">${charged>0?fmt(charged):'–'}</td>
      <td><input type="text" value="${esc(item.justification||'')}" onchange="localDeprec[${i}].justification=this.value"></td>
      <td><button class="btn btn-sm btn-danger" onclick="localDeprec.splice(${i},1);_renderDeprecTable()">🗑️</button></td>
    </tr>`;
  }).join('');
}
function addDepreciationRow(){localDeprec.push({});_renderDeprecTable();}
function calcDeprec(i){
  const item=localDeprec[i]||{};
  const charged=parseFloat(item.purchase_cost||0)*(parseFloat(item.pct_project||0)/100)*(parseFloat(item.pct_life||0)/100);
  const el=document.getElementById(`dep_charged_${i}`);
  if(el) el.textContent=charged>0?fmt(charged):'–';
}
async function saveDepreciation(){
  await post('/api/depreciation',{items:localDeprec});
  state.depreciation=[...localDeprec];
  showToast('Amortissements enregistrés ✓');
}

// ---- COMMENTS ----
let localComments=[];
function renderComments(){
  localComments=[...(state.comments||[])];
  _renderCommentsTable();
}
function _renderCommentsTable(){
  const tbody=document.getElementById('comments-tbody');
  if(!tbody) return;
  if(!localComments.length){tbody.innerHTML='<tr><td colspan="5" class="empty-state">Aucun commentaire.</td></tr>';return;}
  const beOpts=(state.beneficiaries||[]).map(b=>`<option value="${b.id}">${b.id}</option>`).join('');
  const wpOpts=(state.work_packages||[]).map(w=>`<option value="${w.id}">${w.id}</option>`).join('');
  tbody.innerHTML=localComments.map((c,i)=>`<tr>
    <td>${i+1}</td>
    <td><select onchange="localComments[${i}].be_ref=this.value"><option value="">–</option>${beOpts}</select></td>
    <td><select onchange="localComments[${i}].wp_ref=this.value"><option value="">–</option>${wpOpts}</select></td>
    <td><textarea rows="2" onchange="localComments[${i}].text=this.value">${esc(c.text||'')}</textarea></td>
    <td><button class="btn btn-sm btn-danger" onclick="localComments.splice(${i},1);_renderCommentsTable()">🗑️</button></td>
  </tr>`).join('');
}
function addComment(){localComments.push({be_ref:'',wp_ref:'',text:''});_renderCommentsTable();}
async function saveComments(){
  await post('/api/comments',{comments:localComments});
  state.comments=[...localComments];
  showToast('Commentaires enregistrés ✓');
}

// ---- RESULTS ----
async function loadResults(){
  const res=await fetch('/api/results');
  const data=await res.json();
  renderResults(data);
}
function renderResults(data){
  const {totals,state:s}=data;
  const container=document.getElementById('results-container');
  const bes=s.beneficiaries||[];
  const wps=s.work_packages||[];
  if(!bes.length||!wps.length){container.innerHTML='<div class="empty-state">Ajoutez des bénéficiaires et des WP.</div>';return;}
  let globalF=0,globalLump=0,globalPM=0;
  bes.forEach(be=>{const t=totals[be.id];if(t){globalF+=t.total_F;globalLump+=t.lump_sum;globalPM+=t.person_months;}});
  let html=`<div class="card"><h2>📊 Récapitulatif global</h2>
    <div class="results-summary">
      <div class="stat-card"><div class="stat-value">${bes.length}</div><div class="stat-label">Bénéficiaires</div></div>
      <div class="stat-card"><div class="stat-value">${wps.length}</div><div class="stat-label">Work Packages</div></div>
      <div class="stat-card"><div class="stat-value">${globalPM.toFixed(1)}</div><div class="stat-label">Person-mois totaux</div></div>
      <div class="stat-card"><div class="stat-value">${fmt(globalF)}</div><div class="stat-label">Total coûts (F)</div></div>
      <div class="stat-card gold"><div class="stat-value">${fmt(globalLump)}</div><div class="stat-label">Lump Sum total demandé</div></div>
    </div></div>`;

  // Lump sum breakdown
  html+=`<div class="card"><h2>🧮 Ventilation Lump Sum – BE × WP</h2>
    <div style="overflow-x:auto"><table class="breakdown-table">
      <thead><tr><th>Bénéficiaire</th>${wps.map(w=>`<th>${w.id}<br><small>${w.name}</small></th>`).join('')}<th>Total F</th><th>Taux</th><th>Lump Sum</th></tr></thead>
      <tbody>`;
  bes.forEach(be=>{
    const t=totals[be.id]; if(!t) return;
    html+=`<tr><td><strong>${be.id}</strong><br><small>${be.name||''}</small></td>`;
    wps.forEach(wp=>{const v=t.wps[wp.id]?._totals?.F||0;html+=`<td>${v>0?fmt(v):'<span class="zero">–</span>'}</td>`;});
    html+=`<td><strong>${fmt(t.total_F)}</strong></td><td>${(t.funding_rate*100).toFixed(0)}%</td><td style="background:#fffbeb;font-weight:700;color:#b45309">${fmt(t.lump_sum)}</td></tr>`;
  });
  // Totals row
  html+=`<tr class="subtotal"><td><strong>TOTAL</strong></td>`;
  wps.forEach(wp=>{let s=0;bes.forEach(be=>{const t=totals[be.id];if(t?.wps[wp.id]?._totals?.F) s+=t.wps[wp.id]._totals.F;});html+=`<td>${fmt(s)}</td>`;});
  html+=`<td>${fmt(globalF)}</td><td>–</td><td>${fmt(globalLump)}</td></tr>`;
  html+=`</tbody></table></div></div>`;

  // Person-months overview
  html+=`<div class="card"><h2>👥 Vue d'ensemble Person-Mois</h2>
    <div style="overflow-x:auto"><table class="breakdown-table">
      <thead><tr><th>Bénéficiaire</th>${wps.map(w=>`<th>${w.id}</th>`).join('')}<th>Total PM</th></tr></thead><tbody>`;
  bes.forEach(be=>{
    const t=totals[be.id]; if(!t) return;
    html+=`<tr><td><strong>${be.id}</strong> – ${be.name||''}</td>`;
    wps.forEach(wp=>{const pm=t.wps[wp.id]?._totals?.pm||0;html+=`<td>${pm>0?pm:'<span class="zero">–</span>'}</td>`;});
    html+=`<td><strong>${t.person_months}</strong></td></tr>`;
  });
  let totalPM=0; wps.forEach(wp=>{let s=0;bes.forEach(be=>{const t=totals[be.id];if(t?.wps[wp.id]?._totals?.pm) s+=t.wps[wp.id]._totals.pm;});totalPM+=s;});
  html+=`<tr class="subtotal"><td>TOTAL</td>${wps.map(wp=>{let s=0;bes.forEach(be=>{const t=totals[be.id];if(t?.wps[wp.id]?._totals?.pm) s+=t.wps[wp.id]._totals.pm;});return `<td>${s.toFixed(1)}</td>`;}).join('')}<td>${totalPM.toFixed(1)}</td></tr>`;
  html+=`</tbody></table></div></div>`;

  // Detail per BE
  bes.forEach(be=>{
    const t=totals[be.id]; if(!t) return;
    html+=`<div class="results-be-card">
      <div class="results-be-header"><h3>${be.id} – ${be.name||'Sans nom'} <span style="opacity:.7">(${be.acronym||''})</span></h3>
        <span>${be.country||''} | ${(t.funding_rate*100).toFixed(0)}%</span></div>
      <div style="padding:1.25rem"><table class="breakdown-table">
        <thead><tr><th>Catégorie</th>${wps.map(w=>`<th>${w.id}</th>`).join('')}<th>Total</th></tr></thead><tbody>`;
    [['A','Personnel direct'],['B','Sous-traitance'],['C','Achats directs'],['D','Autres coûts directs']].forEach(([k,lbl])=>{
      let rowTotal=0;
      const cells=wps.map(wp=>{const v=t.wps[wp.id]?._totals?.[k]||0;rowTotal+=v;return `<td>${v>0?fmt(v):'<span class="zero">–</span>'}</td>`;}).join('');
      html+=`<tr><td>${lbl}</td>${cells}<td><strong>${rowTotal>0?fmt(rowTotal):'–'}</strong></td></tr>`;
    });
    html+=`<tr class="subtotal"><td>Indirects E (25%×A+C)</td>${wps.map(wp=>{const v=t.wps[wp.id]?._totals?.E||0;return `<td>${v>0?fmt(v):'–'}</td>`;}).join('')}<td>${fmt(t.total_E)}</td></tr>
    <tr class="grand-total"><td>F. TOTAL COÛTS</td>${wps.map(wp=>{const v=t.wps[wp.id]?._totals?.F||0;return `<td>${v>0?fmt(v):'–'}</td>`;}).join('')}<td>${fmt(t.total_F)}</td></tr>
    <tr class="lump-sum"><td>LUMP SUM (F×${(t.funding_rate*100).toFixed(0)}%)</td><td colspan="${wps.length}"></td><td>${fmt(t.lump_sum)}</td></tr>
    </tbody></table></div></div>`;
  });
  container.innerHTML=html;
}

// ---- SESSIONS ----
async function openSessionsPanel(){await refreshSessionsList();document.getElementById('sessions-overlay').classList.add('open');}
function closeSessionsPanel(){document.getElementById('sessions-overlay').classList.remove('open');}
async function refreshSessionsList(){
  const res=await fetch('/api/sessions');
  const sessions=await res.json();
  const list=document.getElementById('sessions-list');
  const empty=document.getElementById('sessions-empty');
  if(!sessions.length){empty.style.display='';list.innerHTML='';return;}
  empty.style.display='none';
  list.innerHTML=sessions.map(s=>`
    <div class="session-card" id="sc_${s.id}">
      <div class="session-card-top">
        <div><div class="session-name" id="sn_${s.id}">${esc(s.name)}</div>
          <div class="session-meta">📅 ${s.saved_at.replace('T',' ')} | 🏛️${s.be_count} BE | 📦${s.wp_count} WP
          ${s.project_acronym?`<br>🏷️ ${esc(s.project_acronym)}${s.project_title?' – '+esc(s.project_title):''}`:''}</div>
        </div>
        <div class="session-actions">
          <button class="btn btn-sm btn-primary" onclick="loadSession('${s.id}')">📂 Charger</button>
          <button class="btn btn-sm btn-gold" onclick="overwriteSession('${s.id}','${esc(s.name)}')" title="Écraser avec les données actuelles">💾 Sauver</button>
          <button class="btn btn-sm btn-secondary" onclick="renameSession('${s.id}')">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSession('${s.id}')">🗑️</button>
        </div>
      </div>
    </div>`).join('');
}
async function saveSession(){
  const name=document.getElementById('session-name-input').value.trim();
  if(!name){alert('Donnez un nom à la session.');return;}
  const res=await post('/api/sessions',{name});
  const json=await res.json();
  if(json.error){alert(json.error);return;}
  document.getElementById('session-name-input').value='';
  await refreshSessionsList();
  showToast(`Session « ${name} » sauvegardée ✓`);
}
async function overwriteSession(sid, name) {
  if (!confirm(`Écraser la session « ${name} » avec les données actuelles ?`)) return;
  await del(`/api/sessions/${sid}`);
  const res = await post('/api/sessions', { name });
  const json = await res.json();
  if (json.error) { alert(json.error); return; }
  await refreshSessionsList();
  showToast(`Session « ${name} » mise à jour ✓`);
}
async function loadSession(sid){
  if(!confirm('Charger cette session ? Les données non sauvegardées seront perdues.')) return;
  const res=await fetch(`/api/sessions/${sid}`);
  const json=await res.json();
  if(json.error){alert(json.error);return;}
  state=json.state;
  renderAll();
  closeSessionsPanel();
  showToast('Session chargée ✓');
}
async function renameSession(sid){
  const cur=document.getElementById(`sn_${sid}`).textContent;
  const newName=prompt('Nouveau nom :',cur);
  if(!newName||newName.trim()===cur) return;
  await put(`/api/sessions/${sid}`,{name:newName.trim()});
  await refreshSessionsList();
  showToast('Session renommée ✓');
}
async function deleteSession(sid){
  if(!confirm('Supprimer cette session ?')) return;
  await del(`/api/sessions/${sid}`);
  await refreshSessionsList();
  showToast('Session supprimée');
}

// ---- MODAL ----
function openModal(title,body){document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;document.getElementById('modal-overlay').classList.add('open');}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');}

// ---- EXPORT RTF ----
async function exportRTF() {
  showToast('Génération du fichier RTF…');
  try {
    const res = await fetch('/api/export/rtf');
    if (!res.ok) throw new Error('Erreur serveur');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fname = (state.project_acronym||'HE_Budget').replace(/\s/g,'_');
    a.href = url; a.download = `${fname}_Results.rtf`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Export RTF téléchargé ✓');
  } catch(e) {
    alert('Erreur lors de l\'export : ' + e.message);
  }
}

// ---- RESET ----
async function resetAll(){
  if(!confirm('Réinitialiser toutes les données ?')) return;
  await post('/api/reset',{});
  state={};
  const res=await fetch('/api/state');
  state=await res.json();
  renderAll();
  showToast('Données réinitialisées');
}

// ---- UTILS ----
function fmt(n){if(n===null||n===undefined||isNaN(n)) return '–';return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n);}
function esc(s){if(!s) return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function v(id){const el=document.getElementById(id);return el?el.value:'';}
function showToast(msg){const t=document.createElement('div');t.textContent=msg;t.style.cssText='position:fixed;bottom:1.5rem;right:1.5rem;background:#16a34a;color:#fff;padding:.75rem 1.25rem;border-radius:8px;font-weight:600;font-size:.9rem;box-shadow:0 4px 16px rgba(0,0,0,.2);z-index:9999';document.body.appendChild(t);setTimeout(()=>t.remove(),2500);}
const post=(url,data)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const put=(url,data)=>fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const del=(url)=>fetch(url,{method:'DELETE'});

// ---- START ----
init();
