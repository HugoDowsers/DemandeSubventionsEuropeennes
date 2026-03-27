from flask import Flask, render_template, request, jsonify, session
import json, uuid, os, threading, tempfile, shutil
from datetime import datetime

app = Flask(__name__)
app.secret_key = 'horizon-budget-2026'

SESSIONS_FILE  = os.path.join(os.path.dirname(__file__), 'saved_sessions.json')
WORKDIR        = os.path.join(os.path.dirname(__file__), 'workstates')
os.makedirs(WORKDIR, exist_ok=True)

# Per-file locks to prevent concurrent read/write corruption
_file_locks = {}
_file_locks_lock = threading.Lock()

def _get_lock(path):
    with _file_locks_lock:
        if path not in _file_locks:
            _file_locks[path] = threading.Lock()
        return _file_locks[path]

# ---- Named sessions (user-saved) ----
def load_saved_sessions():
    if not os.path.exists(SESSIONS_FILE):
        return {}
    lock = _get_lock(SESSIONS_FILE)
    with lock:
        try:
            with open(SESSIONS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}

def write_saved_sessions(sessions):
    lock = _get_lock(SESSIONS_FILE)
    with lock:
        _atomic_write(SESSIONS_FILE, sessions, indent=2)

# ---- Atomic JSON write (write to temp file, then rename) ----
def _atomic_write(path, data, indent=None):
    """Write JSON atomically: temp file → rename. Prevents partial writes."""
    dir_ = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
        shutil.move(tmp_path, path)
    except Exception:
        try: os.unlink(tmp_path)
        except OSError: pass
        raise

# ---- Working state stored as a server-side file, not in the cookie ----
def _get_sid():
    if 'sid' not in session:
        session['sid'] = str(uuid.uuid4())
    return session['sid']

def _state_path(sid):
    return os.path.join(WORKDIR, f'{sid}.json')

def get_state():
    sid = _get_sid()
    path = _state_path(sid)
    lock = _get_lock(path)
    with lock:
        s = None
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                    if content:
                        s = json.loads(content)
            except (json.JSONDecodeError, OSError):
                s = None  # corrupted file → start fresh
        if s is None:
            s = init_state()
    # Migrate missing keys (outside lock — no IO)
    defaults = init_state()
    for k, v in defaults.items():
        if k not in s: s[k] = v
    if 'part_b' not in s:
        s['part_b'] = defaults['part_b']
    else:
        for k, v in defaults['part_b'].items():
            if k not in s['part_b']: s['part_b'][k] = v
    return s

def save_state(state):
    sid = _get_sid()
    path = _state_path(sid)
    lock = _get_lock(path)
    with lock:
        _atomic_write(path, state)

COUNTRIES = [
    {"name":"Austria (AT)","coeff":1.094},{"name":"Belgium (BE)","coeff":1.0},
    {"name":"Bulgaria (BG)","coeff":0.7},{"name":"Croatia (HR)","coeff":0.822},
    {"name":"Cyprus (CY)","coeff":0.812},{"name":"Czechia (CZ)","coeff":0.974},
    {"name":"Denmark (DK)","coeff":1.313},{"name":"Estonia (EE)","coeff":0.952},
    {"name":"Finland (FI)","coeff":1.164},{"name":"France (FR)","coeff":1.166},
    {"name":"Germany (DE)","coeff":1.015},{"name":"Greece (EL)","coeff":0.877},
    {"name":"Hungary (HU)","coeff":0.787},{"name":"Ireland (IE)","coeff":1.358},
    {"name":"Italy (IT)","coeff":0.938},{"name":"Latvia (LV)","coeff":0.856},
    {"name":"Lithuania (LT)","coeff":0.898},{"name":"Luxembourg (LU)","coeff":1.0},
    {"name":"Malta (MT)","coeff":0.918},{"name":"Netherlands (NL)","coeff":1.118},
    {"name":"Poland (PL)","coeff":0.775},{"name":"Portugal (PT)","coeff":0.946},
    {"name":"Romania (RO)","coeff":0.726},{"name":"Slovakia (SK)","coeff":0.829},
    {"name":"Slovenia (SI)","coeff":0.88},{"name":"Spain (ES)","coeff":0.942},
    {"name":"Sweden (SE)","coeff":1.193},{"name":"Albania (AL)","coeff":0.7},
    {"name":"Algeria (DZ)","coeff":0.7},{"name":"Armenia (AM)","coeff":0.7},
    {"name":"Iceland (IS)","coeff":1.357},{"name":"Israel (IL)","coeff":1.358},
    {"name":"Norway (NO)","coeff":1.453},{"name":"Turkey (TR)","coeff":0.7},
    {"name":"Ukraine (UA)","coeff":0.7},{"name":"United Kingdom (GB)","coeff":1.0},
    {"name":"Other / Not listed","coeff":0.7},
]

SME_OWNER_RATE = 9271.0
FUNDING_RATES = [
    {"label":"100% (RIA, CSA, non-profit IA)","value":1.0},
    {"label":"70% (IA standard)","value":0.7},
    {"label":"60% (IA exceptional)","value":0.6},
]
STAFF_PROFILES = [
    {"id":"A1_senior","label":"Senior Scientists / Senior Expert","section":"A"},
    {"id":"A1_junior","label":"Junior Scientists / Junior Expert","section":"A"},
    {"id":"A1_technical","label":"Technical Personnel","section":"A"},
    {"id":"A1_admin","label":"Administrative Personnel","section":"A"},
    {"id":"A1_others","label":"Others (employees)","section":"A"},
    {"id":"A2","label":"A.2 Natural Persons under direct contract","section":"A"},
    {"id":"A3","label":"A.3 Seconded Persons","section":"A"},
    {"id":"A4","label":"A.4 SME owners / natural person beneficiaries","section":"A","fixed_rate":True},
]
COST_CATEGORIES = STAFF_PROFILES + [
    {"id":"B1","label":"B. Direct Subcontracting Costs","section":"B"},
    {"id":"C1","label":"C.1 Travel and subsistence","section":"C"},
    {"id":"C2_equipment","label":"C.2 Equipment","section":"C"},
    {"id":"C2_infra","label":"C.2 Infrastructure","section":"C"},
    {"id":"C2_assets","label":"C.2 Other assets","section":"C"},
    {"id":"C3_consumables","label":"C.3 Consumables","section":"C"},
    {"id":"C3_meetings","label":"C.3 Services for meetings/seminars","section":"C"},
    {"id":"C3_dissemination","label":"C.3 Dissemination activities","section":"C"},
    {"id":"C3_publications","label":"C.3 Publication fees","section":"C"},
    {"id":"C3_other","label":"C.3 Other (shipment, insurance, translation...)","section":"C"},
    {"id":"D1","label":"D.1 Financial support to third parties","section":"D"},
    {"id":"D2","label":"D.2 Internally invoiced goods and services","section":"D"},
    {"id":"D3","label":"D.3 Transnational access to research infrastructure","section":"D"},
    {"id":"D4","label":"D.4 Virtual access to research infrastructure","section":"D"},
    {"id":"D5","label":"D.5 PCP/PPI procurement costs","section":"D"},
]

def init_state():
    return {
        "project_title":"","project_acronym":"","coordinator_contact":"",
        "project_duration_months":24,
        "part_b":{
            "summary":"","objectives":"","policy_contribution":"",
            "digital_supply_chain":"","financial_obstacles":"","maturity":"",
            "implementation_plan":"","project_management":"","cost_effectiveness":"",
            "risks":[],"consortium_cooperation":"","outside_resources":"",
            "consortium_management":"","staff_table":[],"expected_outcomes":"",
            "dissemination":"","competitiveness":"","environmental":"",
            "work_plan_overview":"","ethics":"","security":"",
            "double_funding_confirmed":True,"double_funding_detail":"",
            "financial_support_justification":"","previous_projects":[],
        },
        "beneficiaries":[],"work_packages":[],"employees":{},
        "costs":{},"depreciation":[],"comments":[],
        "subcontracting":[],"purchases":{},"milestones":{},"deliverables":{},"tasks":{},"timetable":[],
    }

def calc_totals(state):
    results={}
    employees=state.get('employees',{})
    for be in state.get('beneficiaries',[]):
        be_id=be['id']
        be_emps=employees.get(be_id,[])
        bt={"wps":{},"total_A":0,"total_B":0,"total_C":0,"total_D":0,
            "total_AC":0,"total_ABCD":0,"total_E":0,"total_F":0,
            "lump_sum":0,"funding_rate":be.get('funding_rate',1.0),"person_months":0}
        for wp in state.get('work_packages',[]):
            wp_id=wp['id']
            wpc=state.get('costs',{}).get(f"{be_id}__{wp_id}",{})
            wr={}; tA=tB=tC=tD=pm=0
            for cat in COST_CATEGORIES:
                cid=cat['id']
                items=float(wpc.get(f"{cid}_items",0) or 0)
                if cat.get('fixed_rate'): rate=SME_OWNER_RATE
                else:
                    emp_ref=wpc.get(f"{cid}_emp_ref","")
                    if emp_ref and cat['section']=='A':
                        emp=next((e for e in be_emps if e.get('id')==emp_ref),None)
                        rate=float(emp.get('monthly_salary',0)) if emp else float(wpc.get(f"{cid}_rate",0) or 0)
                    else:
                        rate=float(wpc.get(f"{cid}_rate",0) or 0)
                total=round(items*rate,2)
                wr[cid]={"items":items,"rate":rate,"total":total}
                if cat['section']=='A': tA+=total; pm+=items if cid!='A4' else 0
                elif cat['section']=='B': tB+=total
                elif cat['section']=='C': tC+=total
                elif cat['section']=='D': tD+=total
            tAC=tA+tC; tABCD=tA+tB+tC+tD; tE=round(tAC*0.25,2); tF=round(tABCD+tE,2)
            wr['_totals']={"A":round(tA,2),"B":round(tB,2),"C":round(tC,2),"D":round(tD,2),
                           "AC":round(tAC,2),"ABCD":round(tABCD,2),"E":tE,"F":tF,"pm":round(pm,1)}
            bt["wps"][wp_id]=wr
            bt["total_A"]+=tA; bt["total_B"]+=tB; bt["total_C"]+=tC; bt["total_D"]+=tD; bt["person_months"]+=pm
        bt["total_AC"]=round(bt["total_A"]+bt["total_C"],2)
        bt["total_ABCD"]=round(bt["total_A"]+bt["total_B"]+bt["total_C"]+bt["total_D"],2)
        bt["total_E"]=round(bt["total_AC"]*0.25,2)
        bt["total_F"]=round(bt["total_ABCD"]+bt["total_E"],2)
        bt["lump_sum"]=round(bt["total_F"]*be.get('funding_rate',1.0),2)
        bt["person_months"]=round(bt["person_months"],1)
        results[be_id]=bt
    return results

@app.route('/')
def index():
    return render_template('index.html', countries=COUNTRIES, funding_rates=FUNDING_RATES,
                           cost_categories=COST_CATEGORIES, staff_profiles=STAFF_PROFILES, sme_rate=SME_OWNER_RATE)

@app.route('/api/state', methods=['GET'])
def api_get_state(): return jsonify(get_state())

@app.route('/api/project', methods=['POST'])
def api_project():
    data=request.json; state=get_state()
    for f in ['project_title','project_acronym','coordinator_contact','project_duration_months']:
        if f in data: state[f]=data[f]
    save_state(state); return jsonify({"ok":True})

@app.route('/api/part_b', methods=['POST'])
def api_part_b():
    state=get_state()
    if 'part_b' not in state: state['part_b']={}
    state['part_b'].update(request.json); save_state(state); return jsonify({"ok":True})

@app.route('/api/beneficiary', methods=['POST'])
def api_add_beneficiary():
    data=request.json; state=get_state()
    be={"id":f"BE{len(state['beneficiaries'])+1}",
        "role":"Coordinator" if not state['beneficiaries'] else "Beneficiary",
        "name":data.get('name',''),"acronym":data.get('acronym',''),
        "country":data.get('country',''),"funding_rate":float(data.get('funding_rate',1.0)),
        "org_type":data.get('org_type',''),"description":data.get('description','')}
    state['beneficiaries'].append(be)
    if 'employees' not in state: state['employees']={}
    state['employees'][be['id']]=[]
    save_state(state); return jsonify({"ok":True,"be":be})

@app.route('/api/beneficiary/<be_id>', methods=['PUT'])
def api_update_beneficiary(be_id):
    data=request.json; state=get_state()
    for be in state['beneficiaries']:
        if be['id']==be_id:
            for f in ['name','acronym','country','funding_rate','org_type','description']:
                if f in data: be[f]=float(data[f]) if f=='funding_rate' else data[f]
            break
    save_state(state); return jsonify({"ok":True})

@app.route('/api/beneficiary/<be_id>', methods=['DELETE'])
def api_delete_beneficiary(be_id):
    state=get_state()
    state['beneficiaries']=[b for b in state['beneficiaries'] if b['id']!=be_id]
    save_state(state); return jsonify({"ok":True})

@app.route('/api/employees/<be_id>', methods=['GET'])
def api_get_employees(be_id): return jsonify(get_state().get('employees',{}).get(be_id,[]))

@app.route('/api/employees/<be_id>', methods=['POST'])
def api_save_employees(be_id):
    state=get_state()
    if 'employees' not in state: state['employees']={}
    state['employees'][be_id]=request.json.get('employees',[])
    save_state(state); return jsonify({"ok":True})

@app.route('/api/workpackage', methods=['POST'])
def api_add_wp():
    data=request.json; state=get_state()
    wp={"id":f"WP{len(state['work_packages'])+1}","name":data.get('name',''),
        "lead_be":data.get('lead_be',''),"start_month":data.get('start_month',1),
        "end_month":data.get('end_month',state.get('project_duration_months',24)),
        "objectives":data.get('objectives',''),"description":data.get('description','')}
    state['work_packages'].append(wp); save_state(state); return jsonify({"ok":True,"wp":wp})

@app.route('/api/workpackage/<wp_id>', methods=['PUT'])
def api_update_wp(wp_id):
    data=request.json; state=get_state()
    for wp in state['work_packages']:
        if wp['id']==wp_id:
            for f in ['name','lead_be','start_month','end_month','objectives','description']:
                if f in data: wp[f]=data[f]
            break
    save_state(state); return jsonify({"ok":True})

@app.route('/api/workpackage/<wp_id>', methods=['DELETE'])
def api_delete_wp(wp_id):
    state=get_state()
    state['work_packages']=[w for w in state['work_packages'] if w['id']!=wp_id]
    save_state(state); return jsonify({"ok":True})

@app.route('/api/tasks/<wp_id>', methods=['POST'])
def api_save_tasks(wp_id):
    state=get_state()
    if 'tasks' not in state: state['tasks']={}
    state['tasks'][wp_id]=request.json.get('tasks',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/milestones/<wp_id>', methods=['POST'])
def api_save_milestones(wp_id):
    state=get_state()
    if 'milestones' not in state: state['milestones']={}
    state['milestones'][wp_id]=request.json.get('milestones',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/deliverables/<wp_id>', methods=['POST'])
def api_save_deliverables(wp_id):
    state=get_state()
    if 'deliverables' not in state: state['deliverables']={}
    state['deliverables'][wp_id]=request.json.get('deliverables',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/costs', methods=['POST'])
def api_save_costs():
    data=request.json; state=get_state()
    state['costs'][f"{data['be_id']}__{data['wp_id']}"]=data['costs']
    save_state(state); return jsonify({"ok":True})

@app.route('/api/depreciation', methods=['POST'])
def api_save_depreciation():
    state=get_state(); state['depreciation']=request.json.get('items',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/subcontracting', methods=['POST'])
def api_save_subcontracting():
    state=get_state(); state['subcontracting']=request.json.get('items',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/purchases/<be_id>', methods=['POST'])
def api_save_purchases(be_id):
    state=get_state()
    if 'purchases' not in state: state['purchases']={}
    state['purchases'][be_id]=request.json.get('items',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/comments', methods=['POST'])
def api_save_comments():
    state=get_state(); state['comments']=request.json.get('comments',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/timetable', methods=['POST'])
def api_save_timetable():
    state=get_state(); state['timetable']=request.json.get('tasks',[]); save_state(state); return jsonify({"ok":True})

@app.route('/api/results')
def api_results():
    state=get_state(); return jsonify({"totals":calc_totals(state),"state":state})

@app.route('/api/reset', methods=['POST'])
def api_reset():
    save_state(init_state())
    return jsonify({"ok":True})

@app.route('/api/sessions', methods=['GET'])
def api_list_sessions():
    sessions=load_saved_sessions()
    result=[{"id":sid,"name":d.get("name",sid),"saved_at":d.get("saved_at",""),
             "project_title":d.get("state",{}).get("project_title",""),
             "project_acronym":d.get("state",{}).get("project_acronym",""),
             "be_count":len(d.get("state",{}).get("beneficiaries",[])),
             "wp_count":len(d.get("state",{}).get("work_packages",[]))} for sid,d in sessions.items()]
    result.sort(key=lambda x:x["saved_at"],reverse=True); return jsonify(result)

@app.route('/api/sessions', methods=['POST'])
def api_save_session():
    name=request.json.get("name","").strip()
    if not name: return jsonify({"error":"Le nom est requis."}),400
    sessions=load_saved_sessions(); sid=str(uuid.uuid4())[:8]
    sessions[sid]={"name":name,"saved_at":datetime.now().isoformat(timespec="seconds"),"state":get_state()}
    write_saved_sessions(sessions); return jsonify({"ok":True,"id":sid,"name":name})

@app.route('/api/sessions/<sid>', methods=['GET'])
def api_load_session(sid):
    sessions=load_saved_sessions()
    if sid not in sessions: return jsonify({"error":"Session introuvable."}),404
    loaded = sessions[sid]["state"]
    save_state(loaded)
    return jsonify({"ok":True,"state":loaded})

@app.route('/api/sessions/<sid>', methods=['PUT'])
def api_rename_session(sid):
    sessions=load_saved_sessions()
    if sid not in sessions: return jsonify({"error":"Session introuvable."}),404
    new_name=request.json.get("name","").strip()
    if not new_name: return jsonify({"error":"Nom requis."}),400
    sessions[sid]["name"]=new_name; write_saved_sessions(sessions); return jsonify({"ok":True})

@app.route('/api/sessions/<sid>', methods=['DELETE'])
def api_delete_session(sid):
    sessions=load_saved_sessions()
    if sid not in sessions: return jsonify({"error":"Session introuvable."}),404
    del sessions[sid]; write_saved_sessions(sessions); return jsonify({"ok":True})

# ---- RTF EXPORT ----
@app.route('/api/export/rtf')
def api_export_rtf():
    from flask import Response
    state = get_state()
    totals = calc_totals(state)
    rtf = build_rtf(state, totals)
    fname = (state.get('project_acronym') or 'HE_Budget').replace(' ','_')
    return Response(
        rtf,
        mimetype='application/rtf',
        headers={'Content-Disposition': f'attachment; filename="{fname}_Results.rtf"'}
    )

def rtf_escape(text):
    if not text: return ''
    text = str(text)
    text = text.replace('\\', '\\\\').replace('{', '\\{').replace('}', '\\}')
    result = []
    for ch in text:
        cp = ord(ch)
        if cp > 127:
            result.append(f'\\u{cp}?')
        else:
            result.append(ch)
    return ''.join(result)

def fmt_eur(n):
    if n is None or n == 0: return '—'
    try:
        return f'{float(n):,.2f} €'.replace(',', ' ')
    except: return str(n)

def fmt_n(n):
    if n is None: return '—'
    try:
        v = float(n)
        return f'{v:.1f}' if v != int(v) else str(int(v))
    except: return str(n)

def build_rtf(state, totals):
    bes = state.get('beneficiaries', [])
    wps = state.get('work_packages', [])
    employees = state.get('employees', {})
    pb = state.get('part_b', {})
    tasks = state.get('tasks', {})
    milestones = state.get('milestones', {})
    deliverables = state.get('deliverables', {})
    timetable = state.get('timetable', [])
    subcontracting = state.get('subcontracting', [])

    # Build a flat id→label map for resolving emp IDs and BE IDs to human names
    collab_map = {}
    for be in bes:
        collab_map[f'BE_{be["id"]}'] = f'{be.get("name", be["id"])} ({be.get("role","BEN")})'
        for emp in employees.get(be['id'], []):
            name = ' '.join(filter(None, [emp.get('last_name',''), emp.get('first_name','')])) or emp.get('id','?')
            collab_map[emp['id']] = f'{name} ({be.get("acronym") or be.get("name","?")})'

    def resolve_participants(id_list):
        if not id_list: return ''
        if isinstance(id_list, str): id_list = [id_list]
        return ', '.join(collab_map.get(i, i) for i in id_list if i)

    # RTF color/font table
    header = (
        r'{\rtf1\ansi\ansicpg1252\deff0'
        r'{\fonttbl{\f0\froman\fcharset0 Times New Roman;}{\f1\fswiss\fcharset0 Arial;}{\f2\fmodern\fcharset0 Courier New;}}'
        r'{\colortbl;\red0\green0\blue0;\red0\green51\blue153;\red255\green204\blue0;\red22\green163\blue74;\red220\green38\blue38;\red243\green244\blue246;\red255\green251\blue235;}'
        r'\widowctrl\wpaper16840\wpaperw11906\margl1440\margr1440\margt1440\margb1440'
        '\n'
    )

    lines = [header]

    def p(text='', bold=False, size=24, color=1, indent=0, align='l', space_before=0, space_after=100):
        s = f'\\pard\\sa{space_after}\\sb{space_before}'
        if align == 'c': s += '\\qc'
        if indent: s += f'\\li{indent}'
        s += f'\\f1\\fs{size}\\cf{color} '
        if bold: s += '\\b '
        s += rtf_escape(text)
        if bold: s += '\\b0'
        s += '\\par\n'
        lines.append(s)

    def h1(text): p(text, bold=True, size=32, color=2, space_before=240, space_after=120)
    def h2(text): p(text, bold=True, size=26, color=2, space_before=180, space_after=80)
    def h3(text): p(text, bold=True, size=24, color=1, space_before=120, space_after=60)
    def body(text, indent=0): p(text, size=22, indent=indent, space_after=80)
    def rule(): lines.append(r'{\pard\brdrb\brdrs\brdrw10\brsp20\par}' + '\n')

    # ---- RTF table helpers ----
    # RTF REQUIRES \trowd redefined before EVERY \row (header AND data rows)
    # We encapsulate this properly.

    def make_row_def(widths):
        """Return the \trowd string for a row with given cumulative cell widths."""
        rd = r'\trowd\trgaph60\trleft-60'
        for w in widths: rd += f'\\cellx{w}'
        return rd

    def tbl_begin(widths, headers, header_color=2):
        """Emit a table header row. widths = list of cumulative x positions."""
        rd = make_row_def(widths)
        lines.append('{' + rd + '\n')
        for hdr in headers:
            lines.append(r'{\pard\f1\fs20\b\cf' + str(header_color) + ' ' + rtf_escape(hdr) + r'\b0\cell}')
        lines.append(r'\row}' + '\n')

    def tbl_row(widths, values, bold=False):
        """Emit one data row. Must repeat \trowd for each row."""
        rd = make_row_def(widths)
        lines.append('{' + rd + '\n')
        for val in values:
            prefix = r'{\pard\f1\fs20\b ' if bold else r'{\pard\f1\fs20 '
            suffix = r'\b0\cell}' if bold else r'\cell}'
            lines.append(prefix + rtf_escape(str(val) if val is not None else '') + suffix)
        lines.append(r'\row}' + '\n')

    def tbl_end():
        pass  # rows are self-contained with braces, no explicit end needed

    # ======= COVER PAGE =======
    lines.append(r'{\pard\qc\sb720\f1\fs48\b\cf2 ' + rtf_escape('TECHNICAL DESCRIPTION (PART B)') + r'\b0\par}' + '\n')
    lines.append(r'{\pard\qc\sb120\f1\fs28\cf2 ' + rtf_escape(state.get('project_title','')) + r'\par}' + '\n')
    lines.append(r'{\pard\qc\sb60\f1\fs24\cf1 Acronyme : ' + rtf_escape(state.get('project_acronym','')) + r'\par}' + '\n')
    lines.append(r'{\pard\qc\sb60\f1\fs24\cf1 Coordinateur : ' + rtf_escape(state.get('coordinator_contact','')) + r'\par}' + '\n')
    lines.append(r'{\pard\qc\sb60\f1\fs22\cf1 Dur\u233?e : ' + rtf_escape(str(state.get('project_duration_months',24))) + r' mois\par}' + '\n')
    lines.append(r'{\pard\qc\sb60\f1\fs20\cf1 G\u233?n\u233?r\u233? le ' + rtf_escape(datetime.now().strftime('%d/%m/%Y')) + r'\par}' + '\n')
    lines.append(r'\page' + '\n')

    # ======= PART B NARRATIVE =======
    h1('PROJET — RÉSUMÉ')
    body(pb.get('summary','(non renseigné)'))
    rule()

    h1('1. PERTINENCE')
    h2('1.1 Objectifs et activités')
    body(pb.get('objectives','(non renseigné)'))
    h2('1.2 Contribution aux objectifs politiques à long terme')
    body(pb.get('policy_contribution','(non renseigné)'))
    if pb.get('digital_supply_chain'):
        h2('1.3 Chaîne d\'approvisionnement numérique')
        body(pb.get('digital_supply_chain',''))
    if pb.get('financial_obstacles'):
        h2('1.4 Obstacles financiers')
        body(pb.get('financial_obstacles',''))
    rule()

    h1('2. MISE EN ŒUVRE')
    h2('2.1 Maturité')
    body(pb.get('maturity','(non renseigné)'))
    h2('2.2 Plan de mise en œuvre')
    body(pb.get('implementation_plan','(non renseigné)'))
    if pb.get('project_management'):
        h3('Gestion de projet et assurance qualité')
        body(pb.get('project_management',''))
    if pb.get('cost_effectiveness'):
        h3('Rentabilité et gestion financière')
        body(pb.get('cost_effectiveness',''))

    # Risks table
    risks = pb.get('risks', [])
    if risks:
        h3('Risques critiques')
        widths = [800, 3800, 1200, 5000, 6200, 7200]  # cumulative
        # Convert to cumulative positions
        cum = [800, 3800, 5000, 7400, 8600, 9200]
        tbl_begin(cum, ['N°','Description','WP','Atténuation','Impact','Probabilité'])
        for i, r_ in enumerate(risks):
            tbl_row(cum, [str(i+1), r_.get('description',''), r_.get('wp',''),
                          r_.get('mitigation',''), r_.get('impact',''), r_.get('probability','')])

    h2('2.3 Capacité à réaliser le travail')
    body(pb.get('consortium_cooperation','(non renseigné)'))

    # Staff table
    staff_table = pb.get('staff_table', [])
    if staff_table:
        h3('Équipes et personnel')
        cum = [3000, 5500, 9200]
        tbl_begin(cum, ['Nom / Fonction','Organisation','Rôle / Profil'])
        for s in staff_table:
            tbl_row(cum, [s.get('name_function',''), s.get('organisation',''), s.get('role','')])

    if pb.get('outside_resources'):
        h3('Ressources externes')
        body(pb.get('outside_resources',''))
    if pb.get('consortium_management'):
        h3('Gestion du consortium')
        body(pb.get('consortium_management',''))
    rule()

    h1('3. IMPACT')
    h2('3.1 Résultats attendus et diffusion')
    body(pb.get('expected_outcomes','(non renseigné)'))
    if pb.get('dissemination'):
        h3('Diffusion et communication')
        body(pb.get('dissemination',''))
    h2('3.2 Compétitivité et bénéfices pour la société')
    body(pb.get('competitiveness','(non renseigné)'))
    if pb.get('environmental'):
        h2('3.3 Durabilité environnementale')
        body(pb.get('environmental',''))
    rule()

    h1('4. PLAN DE TRAVAIL')
    h2('4.1 Vue d\'ensemble')
    body(pb.get('work_plan_overview','(non renseigné)'))

    # Work packages detail
    for wp in wps:
        wid = wp['id']
        h2(f'{wid} — {wp.get("name","")}')
        body(f'Durée : M{wp.get("start_month","?")} – M{wp.get("end_month","?")}   |   Lead : {wp.get("lead_be","–")}')
        if wp.get('objectives'): body(f'Objectifs : {wp.get("objectives","")}', indent=360)
        if wp.get('description'): body(wp.get('description',''), indent=360)

        # Tasks — resolved participant names + trowd on every row
        wp_tasks = tasks.get(wid, [])
        if wp_tasks:
            h3(f'Tâches — {wid}')
            cum = [800, 2600, 5200, 7800, 9200]
            tbl_begin(cum, ['N°','Nom','Description','Participants','Sous-traitance'])
            for t in wp_tasks:
                part_str = resolve_participants(t.get('participants_list', []))
                tbl_row(cum, [t.get('num',''), t.get('name',''), t.get('description',''),
                              part_str, t.get('subcontracting','')])

        # Milestones
        wp_ms = milestones.get(wid, [])
        if wp_ms:
            h3(f'Jalons — {wid}')
            cum = [600, 2600, 3600, 6000, 7200, 9200]
            tbl_begin(cum, ['N°','Nom','Lead','Description','Mois','Vérification'])
            for m in wp_ms:
                tbl_row(cum, [m.get('num',''), m.get('name',''), m.get('lead',''),
                              m.get('description',''), str(m.get('due_month','')), m.get('verification','')])

        # Deliverables
        wp_del = deliverables.get(wid, [])
        if wp_del:
            h3(f'Livrables — {wid}')
            cum = [600, 2200, 3200, 5000, 6400, 7200, 9200]
            tbl_begin(cum, ['N°','Nom','Lead','Type','Diffusion','Mois','Description'])
            for d in wp_del:
                tbl_row(cum, [d.get('num',''), d.get('name',''), d.get('lead',''), d.get('type',''),
                              d.get('dissemination',''), str(d.get('due_month','')), d.get('description','')])

    # Subcontracting
    if subcontracting:
        h2('Sous-traitance')
        cum = [600, 1400, 2800, 5000, 6200, 7800, 9200]
        tbl_begin(cum, ['WP','N°','Nom','Description','Coût (€)','Justification','Best Value'])
        for s in subcontracting:
            tbl_row(cum, [s.get('wp',''), s.get('num',''), s.get('name',''), s.get('description',''),
                          fmt_eur(s.get('cost',0)), s.get('justification',''), s.get('best_value','')])

    # Timetable (tasks from WP tasks with months)
    has_timetable = any(
        (t.get('months') or [])
        for wid in [w['id'] for w in wps]
        for t in tasks.get(wid, [])
    )
    if has_timetable:
        h2('Calendrier')
        dur = int(state.get('project_duration_months', 24))
        months = list(range(1, dur+1))
        name_w = 2400
        dur_cell_w = max(180, (9200 - name_w) // len(months)) if months else 280
        cum_tt = [name_w] + [name_w + dur_cell_w * (i+1) for i in range(len(months))]
        tbl_begin(cum_tt, ['Tâche / WP'] + [f'M{m}' for m in months])
        for wp in wps:
            wid = wp['id']
            for t in tasks.get(wid, []):
                if not t.get('months'): continue
                label = f'{wid} · {t.get("num","")  } {t.get("name","")}'
                cells = [label] + ['█' if m in t['months'] else '' for m in months]
                tbl_row(cum_tt, cells)

    rule()

    # ======= BUDGET SECTION =======
    lines.append(r'\page' + '\n')
    h1('BUDGET — RÉSULTATS FINANCIERS')

    global_F    = sum(totals.get(be['id'],{}).get('total_F',0)    for be in bes)
    global_lump = sum(totals.get(be['id'],{}).get('lump_sum',0)   for be in bes)
    global_pm   = sum(totals.get(be['id'],{}).get('person_months',0) for be in bes)

    p(f'Total coûts (F) : {fmt_eur(global_F)}   |   Lump Sum demandé : {fmt_eur(global_lump)}   |   Person-mois : {fmt_n(global_pm)}',
      bold=False, size=24, color=2, space_before=60, space_after=120)

    # Lump sum breakdown BE × WP
    if bes and wps:
        h2('Ventilation du Lump Sum — BE × WP')
        be_w = 2200
        wp_w = max(700, (9200 - be_w - 1200 - 700 - 1300) // len(wps)) if len(wps) else 1000
        pos = be_w
        cum_ls = [be_w]
        for _ in wps:
            pos += wp_w; cum_ls.append(pos)
        pos += 1200; cum_ls.append(pos)
        pos += 700;  cum_ls.append(pos)
        pos += 1300; cum_ls.append(pos)

        tbl_begin(cum_ls, ['Bénéficiaire'] + [w['id'] for w in wps] + ['Total F','Taux','Lump Sum'])
        for be in bes:
            t = totals.get(be['id'], {})
            row_vals = [f"{be['id']} — {be.get('name','')}"]
            for wp in wps:
                val = t.get('wps',{}).get(wp['id'],{}).get('_totals',{}).get('F',0)
                row_vals.append(fmt_eur(val) if val else '—')
            row_vals += [fmt_eur(t.get('total_F',0)),
                         f"{t.get('funding_rate',1)*100:.0f}%",
                         fmt_eur(t.get('lump_sum',0))]
            tbl_row(cum_ls, row_vals)
        # Total row
        tot_row = ['TOTAL']
        for wp in wps:
            s = sum(totals.get(be['id'],{}).get('wps',{}).get(wp['id'],{}).get('_totals',{}).get('F',0) for be in bes)
            tot_row.append(fmt_eur(s))
        tot_row += [fmt_eur(global_F), '—', fmt_eur(global_lump)]
        tbl_row(cum_ls, tot_row, bold=True)

    # Person-months overview
    if bes and wps:
        h2('Vue d\'ensemble Person-Mois')
        tbl_begin(cum_ls, ['Bénéficiaire'] + [w['id'] for w in wps] + ['Total PM','',''])
        for be in bes:
            t = totals.get(be['id'], {})
            row_vals = [f"{be['id']} — {be.get('name','')}"]
            for wp in wps:
                pm = t.get('wps',{}).get(wp['id'],{}).get('_totals',{}).get('pm',0)
                row_vals.append(fmt_n(pm) if pm else '—')
            row_vals += [fmt_n(t.get('person_months',0)), '', '']
            tbl_row(cum_ls, row_vals)

    # Detail per BE
    for be in bes:
        t = totals.get(be['id'], {})
        if not t: continue
        h2(f"{be['id']} — {be.get('name','')} ({be.get('acronym','')})")
        body(f"Pays : {be.get('country','–')}   |   Taux : {t.get('funding_rate',1)*100:.0f}%")

        # Employees
        emps = employees.get(be['id'], [])
        if emps:
            h3('Équipe')
            cum_e = [2400, 4400, 6800, 8000, 9200]
            tbl_begin(cum_e, ['NOM','Prénom','Profil','Salaire/mois (€)','Note'])
            for emp in emps:
                profile_label = next((p['label'] for p in STAFF_PROFILES if p['id']==emp.get('profile','')), emp.get('profile',''))
                tbl_row(cum_e, [emp.get('last_name',''), emp.get('first_name',''),
                                profile_label, fmt_eur(emp.get('monthly_salary',0)), emp.get('note','')])

        # Cost breakdown per WP
        if wps:
            h3('Détail des coûts par WP')
            be_lbl_w = 2200
            wp_cw = max(700, (9200 - be_lbl_w - 1200) // len(wps)) if len(wps) else 1000
            pos2 = be_lbl_w
            cum_c = [be_lbl_w]
            for _ in wps:
                pos2 += wp_cw; cum_c.append(pos2)
            pos2 += 1200; cum_c.append(pos2)

            tbl_begin(cum_c, ['Catégorie'] + [w['id'] for w in wps] + ['Total'])
            for sec_key, sec_label in [('A','Personnel'),('B','Sous-traitance'),
                                        ('C','Achats'),('D','Autres'),
                                        ('E','Indirects (25%)'),('F','TOTAL')]:
                row_total = 0
                vals = [sec_label]
                for wp in wps:
                    val = t.get('wps',{}).get(wp['id'],{}).get('_totals',{}).get(sec_key,0)
                    row_total += val or 0
                    vals.append(fmt_eur(val) if val else '—')
                vals.append(fmt_eur(row_total))
                tbl_row(cum_c, vals, bold=(sec_key=='F'))
            # Lump sum row
            tbl_row(cum_c, ['LUMP SUM'] + [''] * len(wps) + [fmt_eur(t.get('lump_sum',0))], bold=True)

    # ======= OTHER =======
    if pb.get('ethics') or pb.get('security'):
        rule()
        h1('5. AUTRE')
        if pb.get('ethics'):
            h2('5.1 Éthique')
            body(pb.get('ethics',''))
        if pb.get('security'):
            h2('5.2 Sécurité')
            body(pb.get('security',''))

    # Previous projects
    prev = pb.get('previous_projects', [])
    if prev:
        rule()
        h1('PROJETS PRÉCÉDENTS')
        cum_pp = [2000, 4200, 5400, 6000, 7400, 9200]
        tbl_begin(cum_pp, ['Participant','Référence & Titre','Période','Rôle','Montant (€)','Site web'])
        for proj in prev:
            tbl_row(cum_pp, [proj.get('participant',''), proj.get('reference',''), proj.get('period',''),
                             proj.get('role',''), fmt_eur(proj.get('amount',0)), proj.get('website','')])

    lines.append(r'}')
    return ''.join(lines)

if __name__=='__main__':
    app.run(debug=True,port=5000)

if __name__=='__main__':
    app.run(debug=True,port=5000)
