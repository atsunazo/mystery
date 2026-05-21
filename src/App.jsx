import { useEffect, useMemo, useState } from 'react'
import worksData from './data/group-sne-works.json'
import { db } from './firebase'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'

const DATE_STATUSES = [
  { key: 'ok', label: '笳�' },
  { key: 'maybe', label: '笆ｳ' },
  { key: 'ng', label: 'ﾃ�' },
]
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']

function getEventIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('event')?.trim() || 'default-event'
}
function createMemberDraft() {
  return { id: '', name: '', notes: '', workPrefs: {}, workDatePrefs: {} }
}
function createWorkDraft() {
  return { id: '', title: '', playerMin: 3, playerMax: 5, durationMin: 180, memo: '' }
}
function normalizeMember(row) {
  return {
    id: row.id,
    name: row.name || '',
    notes: row.notes || '',
    workPrefs: row.workPrefs || {},
    workDatePrefs: row.workDatePrefs || {},
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  }
}
function normalizeWork(row, source = 'custom') {
  const playerMin = Number(row.playerMin ?? row.minPlayers ?? 0) || 0
  const playerMax = Number(row.playerMax ?? row.maxPlayers ?? playerMin) || playerMin
  const durationMin = Number(row.durationMin ?? row.playTimeMinutes ?? 0) || 0
  return {
    id: row.id,
    title: row.title || '',
    playerMin,
    playerMax,
    playerCountText: row.playerCountText || `${playerMin}${playerMax && playerMax !== playerMin ? `縲�${playerMax}` : ''}莠ｺ`,
    durationMin,
    memo: row.memo || row.description || '',
    displayOrder: Number(row.displayOrder ?? 9999),
    source,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  }
}
function getWorkPref(member, workId) {
  return member.workPrefs?.[workId] || { played: false, wanted: false, lendable: false }
}
function getWorkSymbol(member, workId) {
  const pref = getWorkPref(member, workId)
  if (pref.played) return 'ﾃ�'
  if (pref.wanted) return '笳�'
  return '笆ｳ'
}
function getWorkSymbolClass(member, workId) {
  const pref = getWorkPref(member, workId)
  if (pref.played) return 'played'
  if (pref.wanted) return 'wanted'
  return 'neutral'
}
function getCandidateMessage(work, count) {
  if (count < work.playerMin) return `縺ゅ→${work.playerMin - count}莠ｺ縺ｧ髢句ぎ蜿ｯ`
  if (work.playerMax && count > work.playerMax) return `${count - work.playerMax}莠ｺ螟壹＞`
  return '髢句ぎ譚｡莉ｶOK'
}
function formatDateLabel(value) {
  return value ? value.replace('T', ' ') : ''
}

export default function App() {
  const [eventId] = useState(getEventIdFromUrl())
  const [members, setMembers] = useState([])
  const [customWorks, setCustomWorks] = useState([])
  const [activeTab, setActiveTab] = useState('home')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState(createMemberDraft())
  const [mobileSection, setMobileSection] = useState('summary')
  const [memberWorkSearch, setMemberWorkSearch] = useState('')
  const [workSearch, setWorkSearch] = useState('')
  const [selectedWorkId, setSelectedWorkId] = useState('')
  const [workDates, setWorkDates] = useState([])
  const [newWorkDate, setNewWorkDate] = useState('')
  const [newWorkHour, setNewWorkHour] = useState('19')
  const [newWorkMinute, setNewWorkMinute] = useState('00')
  const [workDateCounts, setWorkDateCounts] = useState({})
  const [editorDatesMap, setEditorDatesMap] = useState({})
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [workEditorOpen, setWorkEditorOpen] = useState(false)
  const [workDraft, setWorkDraft] = useState(createWorkDraft())

  const defaultWorks = useMemo(() => {
    return [...(worksData.works || [])]
      .map((work) => normalizeWork(work, 'default'))
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [])

  const works = useMemo(() => {
    const map = new Map()
    defaultWorks.forEach((work) => map.set(work.id, work))
    customWorks.forEach((work) => map.set(work.id, work))
    return [...map.values()].sort((a, b) => {
      if (a.source !== b.source) return a.source === 'custom' ? -1 : 1
      return a.displayOrder - b.displayOrder || a.title.localeCompare(b.title, 'ja')
    })
  }, [defaultWorks, customWorks])

  useEffect(() => {
    setLoadingMembers(true)
    const unsubscribe = onSnapshot(collection(db, 'events', eventId, 'members'), (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeMember({ id: row.id, ...row.data() }))
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      setMembers(rows)
      setLoadingMembers(false)
    })
    return () => unsubscribe()
  }, [eventId])

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'events', eventId, 'works'), (snapshot) => {
      const rows = snapshot.docs.map((row) => normalizeWork({ id: row.id, ...row.data() }, 'custom'))
      setCustomWorks(rows)
    })
    return () => unsubscribe()
  }, [eventId])

  useEffect(() => {
    if (!selectedWorkId) {
      setWorkDates([])
      return
    }
    const datesRef = collection(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates')
    const unsubscribe = onSnapshot(datesRef, (snapshot) => {
      const rows = snapshot.docs
        .map((row) => ({ id: row.id, ...row.data() }))
        .sort((a, b) => (a.rawValue || '').localeCompare(b.rawValue || ''))
      setWorkDates(rows)
    })
    return () => unsubscribe()
  }, [eventId, selectedWorkId])

  useEffect(() => {
    if (works.length === 0) {
      setWorkDateCounts({})
      return
    }
    const unsubscribes = works.map((work) => {
      const datesRef = collection(db, 'events', eventId, 'workSchedules', work.id, 'dates')
      return onSnapshot(datesRef, (snapshot) => {
        setWorkDateCounts((prev) => ({ ...prev, [work.id]: snapshot.size }))
      })
    })
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [eventId, works])

  const draftWantedWorkIds = useMemo(() => {
    return works
      .filter((work) => {
        const pref = draft.workPrefs?.[work.id]
        return pref?.wanted && !pref?.played
      })
      .map((work) => work.id)
  }, [works, draft.workPrefs])
  const draftWantedWorkKey = draftWantedWorkIds.join('|')

  useEffect(() => {
    if (!editorOpen) {
      setEditorDatesMap({})
      return
    }
    setEditorDatesMap({})
    const unsubscribes = draftWantedWorkIds.map((workId) => {
      const datesRef = collection(db, 'events', eventId, 'workSchedules', workId, 'dates')
      return onSnapshot(datesRef, (snapshot) => {
        const rows = snapshot.docs
          .map((row) => ({ id: row.id, ...row.data() }))
          .sort((a, b) => (a.rawValue || '').localeCompare(b.rawValue || ''))
        setEditorDatesMap((prev) => ({ ...prev, [workId]: rows }))
      })
    })
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [editorOpen, eventId, draftWantedWorkKey])

  useEffect(() => {
    if (!editorOpen && !workEditorOpen) return
    const scrollY = window.scrollY
    document.documentElement.classList.add('modal-lock')
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    return () => {
      const top = document.body.style.top
      const restoreY = top ? Math.abs(parseInt(top, 10)) : 0
      document.documentElement.classList.remove('modal-lock')
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.width = ''
      window.scrollTo(0, restoreY)
    }
  }, [editorOpen, workEditorOpen])

  const visibleWorks = useMemo(() => {
    const keyword = workSearch.trim().toLowerCase()
    if (!keyword) return works
    return works.filter((work) => work.title.toLowerCase().includes(keyword))
  }, [works, workSearch])

  const editorVisibleWorks = useMemo(() => {
    const keyword = memberWorkSearch.trim().toLowerCase()
    if (!keyword) return works
    return works.filter((work) => work.title.toLowerCase().includes(keyword))
  }, [works, memberWorkSearch])

  const matrixWorks = works
  const matrixGridTemplate = `clamp(112px, 38vw, 180px) 24px 24px 24px repeat(${members.length}, 36px)`

  const selectedWork = useMemo(() => works.find((work) => work.id === selectedWorkId) || null, [works, selectedWorkId])

  const workStats = useMemo(() => {
    const stats = new Map()
    works.forEach((work) => {
      let wanted = 0
      let neutral = 0
      let played = 0
      let lendable = 0
      members.forEach((member) => {
        const pref = getWorkPref(member, work.id)
        if (pref.played) played += 1
        else if (pref.wanted) wanted += 1
        else neutral += 1
        if (pref.lendable) lendable += 1
      })
      stats.set(work.id, { wanted, neutral, played, lendable })
    })
    return stats
  }, [works, members])

  const activeRecruitments = useMemo(() => {
    return works
      .map((work) => ({ work, stats: workStats.get(work.id) || { wanted: 0, neutral: 0, played: 0, lendable: 0 } }))
      .filter(({ work }) => (workDateCounts[work.id] || 0) > 0)
      .sort((a, b) => b.stats.wanted - a.stats.wanted || a.work.title.localeCompare(b.work.title, 'ja'))
  }, [works, workStats, workDateCounts])

  const selectedWantedMembers = useMemo(() => {
    if (!selectedWorkId) return []
    return members.filter((member) => {
      const pref = getWorkPref(member, selectedWorkId)
      return pref.wanted && !pref.played
    })
  }, [members, selectedWorkId])

  const selectedWorkLenders = useMemo(() => {
    if (!selectedWorkId) return []
    return members.filter((member) => getWorkPref(member, selectedWorkId).lendable)
  }, [members, selectedWorkId])

  const selectedWorkScheduleSummary = useMemo(() => {
    return workDates.map((date) => {
      let ok = 0
      let maybe = 0
      let ng = 0
      selectedWantedMembers.forEach((member) => {
        const vote = member.workDatePrefs?.[selectedWorkId]?.[date.id]
        if (vote === 'ok') ok += 1
        else if (vote === 'maybe') maybe += 1
        else if (vote === 'ng') ng += 1
      })
      return { ...date, ok, maybe, ng }
    })
  }, [selectedWantedMembers, selectedWorkId, workDates])

  const draftWantedWorks = useMemo(() => works.filter((work) => draftWantedWorkIds.includes(work.id)), [works, draftWantedWorkIds])

  function openAddMember() {
    setDraft(createMemberDraft())
    setMemberWorkSearch('')
    setMobileSection('summary')
    setEditorOpen(true)
  }
  function openEditMember(member, section = 'summary') {
    setDraft(JSON.parse(JSON.stringify(member)))
    setMemberWorkSearch('')
    setMobileSection(section)
    setEditorOpen(true)
  }
  function openAddWork() {
    setWorkDraft(createWorkDraft())
    setWorkEditorOpen(true)
  }
  function openEditWork(work) {
    setWorkDraft({
      id: work.source === 'custom' ? work.id : '',
      title: work.title,
      playerMin: work.playerMin,
      playerMax: work.playerMax,
      durationMin: work.durationMin,
      memo: work.memo || '',
    })
    setWorkEditorOpen(true)
  }
  function toggleDraftWorkPref(workId, key) {
    setDraft((prev) => {
      const current = prev.workPrefs?.[workId] || { played: false, wanted: false, lendable: false }
      const next = { ...current, [key]: !current[key] }
      if (key === 'played' && next.played) next.wanted = false
      if (key === 'wanted' && next.wanted) next.played = false
      return { ...prev, workPrefs: { ...prev.workPrefs, [workId]: next } }
    })
  }

  async function saveMember() {
    if (!draft.name.trim()) {
      alert('蜿ょ刈閠�錐繧貞�蜉帙＠縺ｦ縺上□縺輔＞')
      return
    }
    const payload = {
      name: draft.name.trim(),
      notes: draft.notes || '',
      workPrefs: draft.workPrefs || {},
      workDatePrefs: draft.workDatePrefs || {},
      updatedAt: serverTimestamp(),
    }
    if (draft.id) await updateDoc(doc(db, 'events', eventId, 'members', draft.id), payload)
    else await addDoc(collection(db, 'events', eventId, 'members'), { ...payload, createdAt: serverTimestamp() })
    setEditorOpen(false)
  }

  async function removeMember(memberId) {
    if (!window.confirm('縺薙�蜿ょ刈閠�ｒ蜑企勁縺励∪縺吶°��')) return
    await deleteDoc(doc(db, 'events', eventId, 'members', memberId))
  }

  async function saveWork() {
    if (!workDraft.title.trim()) {
      alert('菴懷刀蜷阪ｒ蜈･蜉帙＠縺ｦ縺上□縺輔＞')
      return
    }
    const min = Math.max(1, Number(workDraft.playerMin) || 1)
    const max = Math.max(min, Number(workDraft.playerMax) || min)
    const payload = {
      title: workDraft.title.trim(),
      playerMin: min,
      playerMax: max,
      playerCountText: `${min}${max !== min ? `縲�${max}` : ''}莠ｺ`,
      durationMin: Math.max(0, Number(workDraft.durationMin) || 0),
      memo: workDraft.memo || '',
      displayOrder: Date.now(),
      updatedAt: serverTimestamp(),
    }
    if (workDraft.id) await updateDoc(doc(db, 'events', eventId, 'works', workDraft.id), payload)
    else await addDoc(collection(db, 'events', eventId, 'works'), { ...payload, createdAt: serverTimestamp() })
    setWorkEditorOpen(false)
  }

  async function removeWork(work) {
    if (work.source !== 'custom') {
      alert('蛻晄悄逋ｻ骭ｲ縺ｮ菴懷刀縺ｯ蜑企勁縺ｧ縺阪∪縺帙ｓ縲りｿｽ蜉�縺励◆菴懷刀縺ｮ縺ｿ蜑企勁縺ｧ縺阪∪縺吶�')
      return
    }
    if (!window.confirm('縺薙�菴懷刀繧貞炎髯､縺励∪縺吶°��')) return
    await deleteDoc(doc(db, 'events', eventId, 'works', work.id))
    if (selectedWorkId === work.id) setSelectedWorkId('')
  }

  async function addWorkDate() {
    if (!selectedWorkId || !newWorkDate) return
    const rawValue = `${newWorkDate}T${newWorkHour}:${newWorkMinute}`
    await addDoc(collection(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates'), {
      label: formatDateLabel(rawValue),
      rawValue,
      createdAt: serverTimestamp(),
    })
    setNewWorkDate('')
  }

  async function removeWorkDate(dateId) {
    if (!selectedWorkId) return
    if (!window.confirm('縺薙�蛟呵｣懈律繧貞炎髯､縺励∪縺吶°��')) return
    await deleteDoc(doc(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates', dateId))
  }

  async function updateMemberDateVote(memberId, workId, dateId, status) {
    await updateDoc(doc(db, 'events', eventId, 'members', memberId), {
      [`workDatePrefs.${workId}.${dateId}`]: status,
      updatedAt: serverTimestamp(),
    })
  }

  function updateDraftDateVote(workId, dateId, status) {
    setDraft((prev) => ({
      ...prev,
      workDatePrefs: {
        ...prev.workDatePrefs,
        [workId]: {
          ...(prev.workDatePrefs?.[workId] || {}),
          [dateId]: status,
        },
      },
    }))
  }

  return (
    <div className="app-shell">
      <header className="hero compact-hero">
        <div>
          <p className="eyebrow">Murder Mystery Planner</p>
          <h1>蜍滄寔繝ｻ譌･遞玖ｪｿ謨ｴ繝帙�繝�</h1>
          <p className="hero-copy">蛟呵｣懈律縺後≠繧倶ｽ懷刀縺�縺代ｒ蜍滄寔縺ｨ縺励※陦ｨ遉ｺ縺励∽ｺｺ縺斐→縺ｫ笳倶ｽ懷刀縺ｮ譌･遞九ｒ邱ｨ髮�＠縺ｾ縺吶�</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={openAddMember}>莠ｺ繧定ｿｽ蜉�</button>
          <button className="secondary-button" onClick={openAddWork}>菴懷刀繧定ｿｽ蜉�</button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="荳ｻ隕√ち繝�">
        <button className={activeTab === 'home' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('home')}>繝帙�繝�</button>
        <button className={activeTab === 'members' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('members')}>蜿ょ刈閠�</button>
        <button className={activeTab === 'works' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('works')}>菴懷刀</button>
        <button className={activeTab === 'matrix' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('matrix')}>陦ｨ</button>
      </nav>

      <main className="main-content">
        {activeTab === 'home' && (
          <section className="panel-stack">
            <section className="panel slim-panel">
              <div className="panel-title-row">
                <div>
                  <h2>莉雁供髮�＠縺ｦ縺�ｋ繧ゅ�</h2>
                  <p>隱ｿ謨ｴ逕ｨ縺ｮ蛟呵｣懈律譎ゅ′蜈･縺｣縺ｦ縺�ｋ菴懷刀縺�縺題｡ｨ遉ｺ縺励∪縺吶�</p>
                </div>
              </div>
              {activeRecruitments.length === 0 ? (
                <div className="empty-mini">縺ｾ縺�蜍滄寔縺ｯ縺ゅｊ縺ｾ縺帙ｓ縲ゆｽ懷刀縺ｫ蛟呵｣懈律繧定ｿｽ蜉�縺吶ｋ縺ｨ縺薙％縺ｫ蜃ｺ縺ｾ縺吶�</div>
              ) : (
                <div className="compact-work-list">
                  {activeRecruitments.map(({ work, stats }) => (
                    <article className="compact-work-card" key={work.id}>
                      <button className="compact-work-main" onClick={() => { setSelectedWorkId(work.id); setActiveTab('works') }}>
                        <strong>{work.title}</strong>
                        <span>{work.playerCountText}繝ｻ{work.durationMin}蛻��蛟呵｣懈律{workDateCounts[work.id] || 0}莉ｶ</span>
                      </button>
                      <div className="compact-right centered-stats">
                        <div className="mini-stats one-line">
                          <span className="mini-stat wanted">笳宮stats.wanted}</span>
                          <span className="mini-stat neutral">笆ｳ{stats.neutral}</span>
                          <span className="mini-stat played">ﾃ養stats.played}</span>
                          <span className="mini-stat lend">雋ｸ{stats.lendable}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel slim-panel">
              <div className="panel-title-row">
                <div>
                  <h2>蜿ょ刈閠�</h2>
                  <p>蜷榊燕繧呈款縺吶→縲√◎縺ｮ莠ｺ縺ｮ蟶梧悍菴懷刀縺ｨ譌･遞九ｒ閾ｪ逕ｱ縺ｫ邱ｨ髮�〒縺阪∪縺吶�</p>
                </div>
              </div>
              {loadingMembers ? (
                <div className="empty-mini">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ縺ｧ縺吶�</div>
              ) : members.length === 0 ? (
                <div className="empty-mini">縺ｾ縺�蜿ょ刈閠�′縺�∪縺帙ｓ縲ょ承荳翫�縲御ｺｺ繧定ｿｽ蜉�縲阪°繧臥匳骭ｲ縺励※縺上□縺輔＞縲�</div>
              ) : (
                <div className="person-compact-list">
                  {members.map((member) => {
                    const wantedCount = works.filter((work) => getWorkPref(member, work.id).wanted && !getWorkPref(member, work.id).played).length
                    return (
                      <article className="person-compact-card" key={member.id}>
                        <button className="person-main" onClick={() => openEditMember(member, 'works')}>
                          <strong>{member.name}</strong>
                          <span>笳倶ｽ懷刀 {wantedCount}莉ｶ</span>
                        </button>
                        <button className="icon-edit" onClick={() => openEditMember(member, 'summary')}>邱ｨ髮�</button>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </section>
        )}

        {activeTab === 'members' && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div><h2>蜿ょ刈閠�</h2><p>蜿ょ刈閠�き繝ｼ繝峨°繧峨∝ｸ梧悍菴懷刀繝ｻ譌･遞九ｒ閾ｪ逕ｱ縺ｫ邱ｨ髮�〒縺阪∪縺吶�</p></div>
              <button className="primary-button" onClick={openAddMember}>蜿ょ刈閠�ｒ霑ｽ蜉�</button>
            </div>
            {loadingMembers ? (
              <div className="panel empty-state"><h3>隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ</h3><p>蜿ょ刈閠�ョ繝ｼ繧ｿ繧貞叙蠕励＠縺ｦ縺�∪縺吶�</p></div>
            ) : members.length === 0 ? (
              <div className="panel empty-state"><h3>縺ｾ縺�蜿ょ刈閠�′縺�∪縺帙ｓ</h3><p>譛蛻昴�1莠ｺ繧定ｿｽ蜉�縺励※縺上□縺輔＞縲�</p></div>
            ) : (
              <div className="member-list-grid">
                {members.map((member) => (
                  <article className="panel member-card compact-member" key={member.id}>
                    <button className="member-card-main" onClick={() => openEditMember(member, 'works')}>
                      <h3>{member.name}</h3>
                      <p>{member.notes || '繝｡繝｢縺ｪ縺�'}</p>
                    </button>
                    <div className="member-actions compact-actions action-left">
                      <button className="small-button" onClick={() => openEditMember(member, 'summary')}>邱ｨ髮�</button>
                      <button className="small-button danger" onClick={() => removeMember(member.id)}>蜑企勁</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'works' && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div><h2>菴懷刀</h2><p>菴懷刀繧帝幕縺上→縲≫雷縺ｮ莠ｺ縺�縺代ｒ蟇ｾ雎｡縺ｫ譌･遞玖ｪｿ謨ｴ縺励∪縺吶�</p></div>
              <div className="header-control-row">
                <input className="text-input" value={workSearch} onChange={(e) => setWorkSearch(e.target.value)} placeholder="菴懷刀蜷阪〒讀懃ｴ｢" />
                <button className="secondary-button" onClick={openAddWork}>菴懷刀霑ｽ蜉�</button>
              </div>
            </div>

            {!selectedWork && (
              <div className="compact-work-list">
                {visibleWorks.map((work) => {
                  const stats = workStats.get(work.id) || { wanted: 0, neutral: 0, played: 0, lendable: 0 }
                  return (
                    <article className="compact-work-card" key={work.id}>
                      <button className="compact-work-main" onClick={() => setSelectedWorkId(work.id)}>
                        <strong>{work.title}</strong>
                        <span>{work.playerCountText}繝ｻ{work.durationMin}蛻��蛟呵｣懈律{workDateCounts[work.id] || 0}莉ｶ</span>
                      </button>
                      <div className="compact-right">
                        <div className="mini-stats one-line">
                          <span className="mini-stat wanted">笳宮stats.wanted}</span>
                          <span className="mini-stat neutral">笆ｳ{stats.neutral}</span>
                          <span className="mini-stat played">ﾃ養stats.played}</span>
                          <span className="mini-stat lend">雋ｸ{stats.lendable}</span>
                        </div>
                        <div className="right-actions">
                          <button className="icon-edit" onClick={() => openEditWork(work)}>邱ｨ髮�</button>
                          {work.source === 'custom' && <button className="icon-edit danger" onClick={() => removeWork(work)}>蜑企勁</button>}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}

            {selectedWork && (
              <>
                <div className="panel detail-header compact-detail">
                  <button className="ghost-button" onClick={() => setSelectedWorkId('')}>竊� 荳隕ｧ縺ｸ</button>
                  <div className="detail-title-wrap">
                    <h2>{selectedWork.title}</h2>
                    <p>{selectedWork.playerCountText}繝ｻ{selectedWork.durationMin}蛻�</p>
                  </div>
                  <div className="detail-status-box">
                    <span className="detail-count">笳九�莠ｺ: {selectedWantedMembers.length}</span>
                    <span className="detail-message">{getCandidateMessage(selectedWork, selectedWantedMembers.length)}</span>
                  </div>
                </div>

                <div className="panel two-column-grid">
                  <section className="sub-panel">
                    <h3>譌･遞玖ｪｿ謨ｴ縺ｫ蜈･繧倶ｺｺ�遺雷縺ｮ縺ｿ��</h3>
                    {selectedWantedMembers.length === 0 ? <p>縺ｾ縺�縺�∪縺帙ｓ縲�</p> : (
                      <div className="list-stack">
                        {selectedWantedMembers.map((member) => (
                          <button className="person-row as-button" key={member.id} onClick={() => openEditMember(member, 'dates')}>
                            <span>{member.name}</span><span className="person-tag wanted">笳�</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="sub-panel">
                    <h3>雋ｸ縺怜�縺怜庄閭ｽ</h3>
                    {selectedWorkLenders.length === 0 ? <p>縺ｾ縺�縺�∪縺帙ｓ縲�</p> : (
                      <div className="list-stack">
                        {selectedWorkLenders.map((member) => (
                          <button className="person-row as-button" key={member.id} onClick={() => openEditMember(member, 'works')}>
                            <span>{member.name}</span><span className="person-tag lend">雋ｸ蜃ｺ蜿ｯ</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <div className="panel panel-header schedule-add-panel">
                  <div><h2>縺薙�菴懷刀縺ｮ譌･遞玖ｪｿ謨ｴ</h2><p>譌･莉倥∵凾髢薙∝�繧帝∈繧薙〒蛟呵｣懈律繧定ｿｽ蜉�縺励∪縺吶よ凾髢薙�1譎る俣蛻ｻ縺ｿ縲∝�縺ｯ30蛻�綾縺ｿ縺ｧ縺吶�</p></div>
                  <div className="date-add-box custom-date-box">
                    <input type="date" value={newWorkDate} onChange={(e) => setNewWorkDate(e.target.value)} />
                    <select value={newWorkHour} onChange={(e) => setNewWorkHour(e.target.value)} aria-label="譎�">
                      {HOURS.map((hour) => <option key={hour} value={hour}>{hour}譎�</option>)}
                    </select>
                    <select value={newWorkMinute} onChange={(e) => setNewWorkMinute(e.target.value)} aria-label="蛻�">
                      {MINUTES.map((minute) => <option key={minute} value={minute}>{minute}蛻�</option>)}
                    </select>
                    <button className="primary-button" onClick={addWorkDate}>蛟呵｣懈律繧定ｿｽ蜉�</button>
                  </div>
                </div>

                {selectedWorkScheduleSummary.length === 0 ? (
                  <div className="panel empty-state"><h3>蛟呵｣懈律縺後≠繧翫∪縺帙ｓ</h3><p>縺薙�菴懷刀逕ｨ縺ｮ蛟呵｣懈律繧定ｿｽ蜉�縺励※縺上□縺輔＞縲�</p></div>
                ) : (
                  <div className="panel">
                    <div className="matrix-wrap">
                      <table className="summary-table">
                        <thead><tr><th>譌･遞�</th><th>笳�</th><th>笆ｳ</th><th>ﾃ�</th><th>謫堺ｽ�</th></tr></thead>
                        <tbody>
                          {selectedWorkScheduleSummary.map((date) => (
                            <tr key={date.id}>
                              <td>{date.label}</td><td>{date.ok}莠ｺ</td><td>{date.maybe}莠ｺ</td><td>{date.ng}莠ｺ</td>
                              <td><button className="table-delete" onClick={() => removeWorkDate(date.id)}>蜑企勁</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="vote-grid">
                      {selectedWorkScheduleSummary.map((date) => (
                        <div className="vote-block" key={date.id}>
                          <h3>{date.label}</h3>
                          {selectedWantedMembers.map((member) => {
                            const vote = member.workDatePrefs?.[selectedWorkId]?.[date.id] || ''
                            return (
                              <div className="vote-row" key={`${date.id}-${member.id}`}>
                                <span className="vote-name">{member.name}</span>
                                <div className="segmented-row">
                                  {DATE_STATUSES.map((status) => (
                                    <button key={status.key} className={vote === status.key ? `segment active ${status.key}` : 'segment'} onClick={() => updateMemberDateVote(member.id, selectedWorkId, date.id, status.key)}>{status.label}</button>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === 'matrix' && (
          <section className="panel-stack">
            <div className="panel panel-header"><div><h2>蟶梧悍繝槭ヨ繝ｪ繝�け繧ｹ</h2><p>荳翫�隕句�縺苓｡後→蟾ｦ縺ｮ菴懷刀蛻励ｒ蝗ｺ螳壹＠縲∬｡ｨ縺ｮ荳ｭ縺�縺代〒荳贋ｸ句ｷｦ蜿ｳ縺ｫ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ縺ｧ縺阪∪縺吶�</p></div></div>
            <div className="panel matrix-panel">
              <div className="matrix-hint">莠ｺ縺ｮ蜷榊燕繝ｻ笳銀無ﾃ励�隕句�縺励�荳翫↓蝗ｺ螳壹∽ｽ懷刀蜷阪�蟾ｦ縺ｫ蝗ｺ螳壹＆繧後∪縺吶�</div>
              <div className="matrix-grid-wrap" role="region" aria-label="蟶梧悍繝槭ヨ繝ｪ繝�け繧ｹ">
                <div className="matrix-grid" style={{ gridTemplateColumns: matrixGridTemplate }}>
                  <div className="matrix-grid-cell matrix-head matrix-corner">菴懷刀</div>
                  <div className="matrix-grid-cell matrix-head matrix-sum-head">笳�</div>
                  <div className="matrix-grid-cell matrix-head matrix-sum-head">笆ｳ</div>
                  <div className="matrix-grid-cell matrix-head matrix-sum-head">ﾃ�</div>
                  {members.map((member) => <div key={`head-${member.id}`} className="matrix-grid-cell matrix-head matrix-member-head">{member.name}</div>)}
                  {matrixWorks.flatMap((work) => {
                    const stats = workStats.get(work.id) || { wanted: 0, neutral: 0, played: 0 }
                    return [
                      <button key={`work-${work.id}`} className="matrix-grid-cell matrix-work-cell matrix-work-link" onClick={() => { setSelectedWorkId(work.id); setActiveTab('works') }}>{work.title}</button>,
                      <div key={`wanted-${work.id}`} className="matrix-grid-cell matrix-sum-cell wanted-total">{stats.wanted}</div>,
                      <div key={`neutral-${work.id}`} className="matrix-grid-cell matrix-sum-cell neutral-total">{stats.neutral}</div>,
                      <div key={`played-${work.id}`} className="matrix-grid-cell matrix-sum-cell played-total">{stats.played}</div>,
                      ...members.map((member) => <div key={`${work.id}-${member.id}`} className={`matrix-grid-cell matrix-symbol-cell ${getWorkSymbolClass(member, work.id)}`}>{getWorkSymbol(member, work.id)}</div>)
                    ]
                  })}
                </div>
              </div>
            </div>
          </section>
        )}
     </main>

      {editorOpen && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet mobile-editor-sheet">
            <div className="sheet-header sticky-sheet-header">
              <div><h2>{draft.id ? draft.name || '蜿ょ刈閠�ｒ邱ｨ髮�' : '蜿ょ刈閠�ｒ霑ｽ蜉�'}</h2><p>蝓ｺ譛ｬ諠��ｱ繝ｻ菴懷刀蟶梧悍繝ｻ笳倶ｽ懷刀縺ｮ譌･遞九ｒ邱ｨ髮�＠縺ｾ縺吶�</p></div>
              <button className="ghost-button" onClick={() => setEditorOpen(false)}>髢峨§繧�</button>
            </div>
            <div className="editor-tab-row">
              <button className={mobileSection === 'summary' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('summary')}>蝓ｺ譛ｬ</button>
              <button className={mobileSection === 'works' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('works')}>菴懷刀</button>
              <button className={mobileSection === 'dates' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('dates')}>譌･遞�</button>
            </div>

            {mobileSection === 'summary' && (
              <>
                <section className="editor-section compact-section">
                  <label className="field-label">蜷榊燕</label>
                  <input className="text-input big-input" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="蜷榊燕繧貞�蜉�" />
                </section>
                <section className="editor-section compact-section">
                  <label className="field-label">繧ｳ繝｡繝ｳ繝�</label>
                  <textarea className="text-area big-input" value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="陬懆ｶｳ縺後≠繧後�蜈･蜉�" />
                </section>
              </>
            )}

            {mobileSection === 'works' && (
              <section className="editor-section compact-section">
                <div className="section-title-block"><h3>菴懷刀縺ｮ蟶梧悍迥ｶ豕�</h3><p>笳九↓縺励◆菴懷刀縺�縺代∵律遞九ち繝悶↓蛟呵｣懈律縺悟�縺ｾ縺吶�</p></div>
                <input className="text-input" value={memberWorkSearch} onChange={(e) => setMemberWorkSearch(e.target.value)} placeholder="菴懷刀蜷阪〒邨槭ｊ霎ｼ縺ｿ" />
                <div className="works-editor-list mobile-work-list">
                  {editorVisibleWorks.map((work) => {
                    const pref = draft.workPrefs?.[work.id] || { played: false, wanted: false, lendable: false }
                    return (
                      <article className="mini-work-card mobile-work-card" key={work.id}>
                        <div className="mobile-work-head">
                          <div><h4>{work.title}</h4><p>{work.playerCountText}繝ｻ{work.durationMin}蛻�</p></div>
                          <button className={pref.lendable ? 'small-lend-button active' : 'small-lend-button'} onClick={() => toggleDraftWorkPref(work.id, 'lendable')}>雋ｸ蜃ｺ蜿ｯ</button>
                        </div>
                        <div className="choice-circle-row compact-choice">
                          <button className={pref.wanted ? 'choice-pill wanted active' : 'choice-pill'} onClick={() => toggleDraftWorkPref(work.id, 'wanted')}>笳� 繧�ｊ縺溘＞</button>
                          <button className={!pref.played && !pref.wanted ? 'choice-pill neutral active' : 'choice-pill'} onClick={() => setDraft((prev) => ({ ...prev, workPrefs: { ...prev.workPrefs, [work.id]: { ...(prev.workPrefs?.[work.id] || {}), played: false, wanted: false, lendable: prev.workPrefs?.[work.id]?.lendable || false } } }))}>笆ｳ 菫晉蕗</button>
                          <button className={pref.played ? 'choice-pill played active' : 'choice-pill'} onClick={() => toggleDraftWorkPref(work.id, 'played')}>ﾃ� 繧�▲縺�</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )}

            {mobileSection === 'dates' && (
              <section className="editor-section compact-section">
                <div className="section-title-block"><h3>笳倶ｽ懷刀縺ｮ譌･遞句ｸ梧悍</h3><p>笆ｳ繝ｻﾃ励�菴懷刀縺ｯ縺薙％縺ｫ縺ｯ陦ｨ遉ｺ縺励∪縺帙ｓ縲�</p></div>
                {draftWantedWorks.length === 0 ? (
                  <div className="empty-mini">笳九↓縺励◆菴懷刀縺後≠繧翫∪縺帙ｓ縲ゆｽ懷刀繧ｿ繝悶〒縲娯雷 繧�ｊ縺溘＞縲阪ｒ驕ｸ繧薙〒縺上□縺輔＞縲�</div>
                ) : (
                  <div className="date-work-list">
                    {draftWantedWorks.map((work) => {
                      const dates = editorDatesMap[work.id] || []
                      return (
                        <article className="date-work-card" key={work.id}>
                          <div className="date-work-title"><strong>{work.title}</strong><span>{dates.length}蛟呵｣�</span></div>
                          {dates.length === 0 ? (
                            <div className="empty-mini small">縺薙�菴懷刀縺ｫ縺ｯ蛟呵｣懈律縺後≠繧翫∪縺帙ｓ縲�</div>
                          ) : (
                            <div className="date-vote-mobile-list">
                              {dates.map((date) => {
                                const currentVote = draft.workDatePrefs?.[work.id]?.[date.id] || ''
                                return (
                                  <div className="date-vote-mobile-card compact-date" key={date.id}>
                                    <div className="date-vote-label">{date.label}</div>
                                    <div className="date-circle-buttons compact-date-buttons">
                                      {DATE_STATUSES.map((status) => (
                                        <button key={status.key} className={currentVote === status.key ? `date-pill active ${status.key}` : `date-pill ${status.key}`} onClick={() => updateDraftDateVote(work.id, date.id, status.key)}>{status.label}</button>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            <div className="sheet-bottom-actions sticky-save-row"><button className="primary-button wide" onClick={saveMember}>菫晏ｭ�</button></div>
          </div>
        </div>
      )}

      {workEditorOpen && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet small-sheet">
            <div className="sheet-header"><div><h2>{workDraft.id ? '菴懷刀繧堤ｷｨ髮�' : '菴懷刀繧定ｿｽ蜉�'}</h2><p>霑ｽ蜉�菴懷刀縺ｯ縺薙�繧､繝吶Φ繝亥�縺ｧ菴ｿ縺医∪縺吶�</p></div><button className="ghost-button" onClick={() => setWorkEditorOpen(false)}>髢峨§繧�</button></div>
            <section className="editor-section compact-section">
              <label className="field-label">菴懷刀蜷�</label>
              <input className="text-input big-input" value={workDraft.title} onChange={(e) => setWorkDraft((prev) => ({ ...prev, title: e.target.value }))} placeholder="菴懷刀蜷�" />
              <div className="form-grid-3">
                <label><span>譛蟆台ｺｺ謨ｰ</span><input type="number" min="1" value={workDraft.playerMin} onChange={(e) => setWorkDraft((prev) => ({ ...prev, playerMin: e.target.value }))} /></label>
                <label><span>譛螟ｧ莠ｺ謨ｰ</span><input type="number" min="1" value={workDraft.playerMax} onChange={(e) => setWorkDraft((prev) => ({ ...prev, playerMax: e.target.value }))} /></label>
                <label><span>譎る俣�亥���</span><input type="number" min="0" value={workDraft.durationMin} onChange={(e) => setWorkDraft((prev) => ({ ...prev, durationMin: e.target.value }))} /></label>
              </div>
              <label className="field-label">繝｡繝｢</label>
              <textarea className="text-area" value={workDraft.memo} onChange={(e) => setWorkDraft((prev) => ({ ...prev, memo: e.target.value }))} placeholder="陬懆ｶｳ縺後≠繧後�蜈･蜉�" />
            </section>
            <div className="sheet-bottom-actions"><button className="primary-button wide" onClick={saveWork}>菫晏ｭ�</button></div>
          </div>
        </div>
      )}
    </div>
  )
}