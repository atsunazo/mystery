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
  { key: 'ok', label: '○' },
  { key: 'maybe', label: '△' },
  { key: 'ng', label: '×' },
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
    playerCountText: row.playerCountText || `${playerMin}${playerMax && playerMax !== playerMin ? `〜${playerMax}` : ''}人`,
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
  if (pref.played) return '×'
  if (pref.wanted) return '○'
  return '△'
}
function getWorkSymbolClass(member, workId) {
  const pref = getWorkPref(member, workId)
  if (pref.played) return 'played'
  if (pref.wanted) return 'wanted'
  return 'neutral'
}
function getCandidateMessage(work, count) {
  if (count < work.playerMin) return `あと${work.playerMin - count}人で開催可`
  if (work.playerMax && count > work.playerMax) return `${count - work.playerMax}人多い`
  return '開催条件OK'
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
      alert('参加者名を入力してください')
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
    if (!window.confirm('この参加者を削除しますか？')) return
    await deleteDoc(doc(db, 'events', eventId, 'members', memberId))
  }

  async function saveWork() {
    if (!workDraft.title.trim()) {
      alert('作品名を入力してください')
      return
    }
    const min = Math.max(1, Number(workDraft.playerMin) || 1)
    const max = Math.max(min, Number(workDraft.playerMax) || min)
    const payload = {
      title: workDraft.title.trim(),
      playerMin: min,
      playerMax: max,
      playerCountText: `${min}${max !== min ? `〜${max}` : ''}人`,
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
      alert('初期登録の作品は削除できません。追加した作品のみ削除できます。')
      return
    }
    if (!window.confirm('この作品を削除しますか？')) return
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
    if (!window.confirm('この候補日を削除しますか？')) return
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
          <h1>募集・日程調整ホーム</h1>
          <p className="hero-copy">候補日がある作品だけを募集として表示し、人ごとに○作品の日程を編集します。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={openAddMember}>人を追加</button>
          <button className="secondary-button" onClick={openAddWork}>作品を追加</button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="主要タブ">
        <button className={activeTab === 'home' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('home')}>ホーム</button>
        <button className={activeTab === 'members' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('members')}>参加者</button>
        <button className={activeTab === 'works' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('works')}>作品</button>
        <button className={activeTab === 'matrix' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('matrix')}>表</button>
      </nav>

      <main className="main-content">
        {activeTab === 'home' && (
          <section className="panel-stack">
            <section className="panel slim-panel">
              <div className="panel-title-row">
                <div>
                  <h2>今募集しているもの</h2>
                  <p>調整用の候補日時が入っている作品だけ表示します。</p>
                </div>
              </div>
              {activeRecruitments.length === 0 ? (
                <div className="empty-mini">まだ募集はありません。作品に候補日を追加するとここに出ます。</div>
              ) : (
                <div className="compact-work-list">
                  {activeRecruitments.map(({ work, stats }) => (
                    <article className="compact-work-card" key={work.id}>
                      <button className="compact-work-main" onClick={() => { setSelectedWorkId(work.id); setActiveTab('works') }}>
                        <strong>{work.title}</strong>
                        <span>{work.playerCountText}・{work.durationMin}分・候補日{workDateCounts[work.id] || 0}件</span>
                      </button>
                      <div className="compact-right centered-stats">
                        <div className="mini-stats one-line">
                          <span className="mini-stat wanted">○{stats.wanted}</span>
                          <span className="mini-stat neutral">△{stats.neutral}</span>
                          <span className="mini-stat played">×{stats.played}</span>
                          <span className="mini-stat lend">貸{stats.lendable}</span>
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
                  <h2>参加者</h2>
                  <p>名前を押すと、その人の希望作品と日程を自由に編集できます。</p>
                </div>
              </div>
              {loadingMembers ? (
                <div className="empty-mini">読み込み中です。</div>
              ) : members.length === 0 ? (
                <div className="empty-mini">まだ参加者がいません。右上の「人を追加」から登録してください。</div>
              ) : (
                <div className="person-compact-list">
                  {members.map((member) => {
                    const wantedCount = works.filter((work) => getWorkPref(member, work.id).wanted && !getWorkPref(member, work.id).played).length
                    return (
                      <article className="person-compact-card" key={member.id}>
                        <button className="person-main" onClick={() => openEditMember(member, 'works')}>
                          <strong>{member.name}</strong>
                          <span>○作品 {wantedCount}件</span>
                        </button>
                        <button className="icon-edit" onClick={() => openEditMember(member, 'summary')}>編集</button>
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
              <div><h2>参加者</h2><p>参加者カードから、希望作品・日程を自由に編集できます。</p></div>
              <button className="primary-button" onClick={openAddMember}>参加者を追加</button>
            </div>
            {loadingMembers ? (
              <div className="panel empty-state"><h3>読み込み中</h3><p>参加者データを取得しています。</p></div>
            ) : members.length === 0 ? (
              <div className="panel empty-state"><h3>まだ参加者がいません</h3><p>最初の1人を追加してください。</p></div>
            ) : (
              <div className="member-list-grid">
                {members.map((member) => (
                  <article className="panel member-card compact-member" key={member.id}>
                    <button className="member-card-main" onClick={() => openEditMember(member, 'works')}>
                      <h3>{member.name}</h3>
                      <p>{member.notes || 'メモなし'}</p>
                    </button>
                    <div className="member-actions compact-actions action-left">
                      <button className="small-button" onClick={() => openEditMember(member, 'summary')}>編集</button>
                      <button className="small-button danger" onClick={() => removeMember(member.id)}>削除</button>
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
              <div><h2>作品</h2><p>作品を開くと、○の人だけを対象に日程調整します。</p></div>
              <div className="header-control-row">
                <input className="text-input" value={workSearch} onChange={(e) => setWorkSearch(e.target.value)} placeholder="作品名で検索" />
                <button className="secondary-button" onClick={openAddWork}>作品追加</button>
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
                        <span>{work.playerCountText}・{work.durationMin}分・候補日{workDateCounts[work.id] || 0}件</span>
                      </button>
                      <div className="compact-right">
                        <div className="mini-stats one-line">
                          <span className="mini-stat wanted">○{stats.wanted}</span>
                          <span className="mini-stat neutral">△{stats.neutral}</span>
                          <span className="mini-stat played">×{stats.played}</span>
                          <span className="mini-stat lend">貸{stats.lendable}</span>
                        </div>
                        <div className="right-actions">
                          <button className="icon-edit" onClick={() => openEditWork(work)}>編集</button>
                          {work.source === 'custom' && <button className="icon-edit danger" onClick={() => removeWork(work)}>削除</button>}
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
                  <button className="ghost-button" onClick={() => setSelectedWorkId('')}>← 一覧へ</button>
                  <div className="detail-title-wrap">
                    <h2>{selectedWork.title}</h2>
                    <p>{selectedWork.playerCountText}・{selectedWork.durationMin}分</p>
                  </div>
                  <div className="detail-status-box">
                    <span className="detail-count">○の人: {selectedWantedMembers.length}</span>
                    <span className="detail-message">{getCandidateMessage(selectedWork, selectedWantedMembers.length)}</span>
                  </div>
                </div>

                <div className="panel two-column-grid">
                  <section className="sub-panel">
                    <h3>日程調整に入る人（○のみ）</h3>
                    {selectedWantedMembers.length === 0 ? <p>まだいません。</p> : (
                      <div className="list-stack">
                        {selectedWantedMembers.map((member) => (
                          <button className="person-row as-button" key={member.id} onClick={() => openEditMember(member, 'dates')}>
                            <span>{member.name}</span><span className="person-tag wanted">○</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="sub-panel">
                    <h3>貸し出し可能</h3>
                    {selectedWorkLenders.length === 0 ? <p>まだいません。</p> : (
                      <div className="list-stack">
                        {selectedWorkLenders.map((member) => (
                          <button className="person-row as-button" key={member.id} onClick={() => openEditMember(member, 'works')}>
                            <span>{member.name}</span><span className="person-tag lend">貸出可</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <div className="panel panel-header schedule-add-panel">
                  <div><h2>この作品の日程調整</h2><p>日付、時間、分を選んで候補日を追加します。時間は1時間刻み、分は30分刻みです。</p></div>
                  <div className="date-add-box custom-date-box">
                    <input type="date" value={newWorkDate} onChange={(e) => setNewWorkDate(e.target.value)} />
                    <select value={newWorkHour} onChange={(e) => setNewWorkHour(e.target.value)} aria-label="時">
                      {HOURS.map((hour) => <option key={hour} value={hour}>{hour}時</option>)}
                    </select>
                    <select value={newWorkMinute} onChange={(e) => setNewWorkMinute(e.target.value)} aria-label="分">
                      {MINUTES.map((minute) => <option key={minute} value={minute}>{minute}分</option>)}
                    </select>
                    <button className="primary-button" onClick={addWorkDate}>候補日を追加</button>
                  </div>
                </div>

                {selectedWorkScheduleSummary.length === 0 ? (
                  <div className="panel empty-state"><h3>候補日がありません</h3><p>この作品用の候補日を追加してください。</p></div>
                ) : (
                  <div className="panel">
                    <div className="matrix-wrap">
                      <table className="summary-table">
                        <thead><tr><th>日程</th><th>○</th><th>△</th><th>×</th><th>操作</th></tr></thead>
                        <tbody>
                          {selectedWorkScheduleSummary.map((date) => (
                            <tr key={date.id}>
                              <td>{date.label}</td><td>{date.ok}人</td><td>{date.maybe}人</td><td>{date.ng}人</td>
                              <td><button className="table-delete" onClick={() => removeWorkDate(date.id)}>削除</button></td>
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
            <div className="panel panel-header"><div><h2>希望マトリックス</h2><p>作品タイトル列だけ固定し、右側と上下を表の中でスクロールできます。</p></div></div>
            <div className="panel matrix-panel">
              <div className="matrix-hint">タイトル列は固定、右側は横スクロール、表全体は上下スクロールできます。</div>
              <div className="split-matrix">
                <div className="matrix-fixed">
                  <table className="fixed-table">
                    <thead><tr><th className="work-head-fixed">作品</th></tr></thead>
                    <tbody>
                      {visibleWorks.map((work) => (
                        <tr key={`fixed-${work.id}`}>
                          <td className="work-title-fixed"><button className="matrix-work-link" onClick={() => { setSelectedWorkId(work.id); setActiveTab('works') }}>{work.title}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="matrix-scroll">
                  <table className="scroll-table">
                    <thead><tr><th className="sum-head">○</th><th className="sum-head">△</th><th className="sum-head">×</th>{members.map((member) => <th key={member.id} className="member-head-cell horizontal-name">{member.name}</th>)}</tr></thead>
                    <tbody>
                      {visibleWorks.map((work) => {
                        const stats = workStats.get(work.id) || { wanted: 0, neutral: 0, played: 0 }
                        return (
                          <tr key={`scroll-${work.id}`}>
                            <td className="sum-cell wanted-total">{stats.wanted}</td>
                            <td className="sum-cell neutral-total">{stats.neutral}</td>
                            <td className="sum-cell played-total">{stats.played}</td>
                            {members.map((member) => <td key={`${work.id}-${member.id}`} className={`matrix-symbol-cell ${getWorkSymbolClass(member, work.id)}`}>{getWorkSymbol(member, work.id)}</td>)}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {editorOpen && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet mobile-editor-sheet">
            <div className="editor-sticky-block">
              <div className="sheet-header sticky-sheet-header">
                <div><h2>{draft.id ? draft.name || '参加者を編集' : '参加者を追加'}</h2><p>基本情報・作品希望・○作品の日程を編集します。</p></div>
                <button className="ghost-button" onClick={() => setEditorOpen(false)}>閉じる</button>
              </div>
              <div className="editor-tab-row">
                <button className={mobileSection === 'summary' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('summary')}>基本</button>
                <button className={mobileSection === 'works' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('works')}>作品</button>
                <button className={mobileSection === 'dates' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('dates')}>日程</button>
              </div>
            </div>

            {mobileSection === 'summary' && (
              <>
                <section className="editor-section compact-section">
                  <label className="field-label">名前</label>
                  <input className="text-input big-input" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="名前を入力" />
                </section>
                <section className="editor-section compact-section">
                  <label className="field-label">コメント</label>
                  <textarea className="text-area big-input" value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="補足があれば入力" />
                </section>
              </>
            )}

            {mobileSection === 'works' && (
              <section className="editor-section compact-section">
                <div className="section-title-block"><h3>作品の希望状況</h3><p>○にした作品だけ、日程タブに候補日が出ます。</p></div>
                <input className="text-input" value={memberWorkSearch} onChange={(e) => setMemberWorkSearch(e.target.value)} placeholder="作品名で絞り込み" />
                <div className="works-editor-list mobile-work-list">
                  {editorVisibleWorks.map((work) => {
                    const pref = draft.workPrefs?.[work.id] || { played: false, wanted: false, lendable: false }
                    return (
                      <article className="mini-work-card mobile-work-card" key={work.id}>
                        <div className="mobile-work-head">
                          <div><h4>{work.title}</h4><p>{work.playerCountText}・{work.durationMin}分</p></div>
                          <button className={pref.lendable ? 'small-lend-button active' : 'small-lend-button'} onClick={() => toggleDraftWorkPref(work.id, 'lendable')}>貸出可</button>
                        </div>
                        <div className="choice-circle-row compact-choice">
                          <button className={pref.wanted ? 'choice-pill wanted active' : 'choice-pill'} onClick={() => toggleDraftWorkPref(work.id, 'wanted')}>○ やりたい</button>
                          <button className={!pref.played && !pref.wanted ? 'choice-pill neutral active' : 'choice-pill'} onClick={() => setDraft((prev) => ({ ...prev, workPrefs: { ...prev.workPrefs, [work.id]: { ...(prev.workPrefs?.[work.id] || {}), played: false, wanted: false, lendable: prev.workPrefs?.[work.id]?.lendable || false } } }))}>△ 保留</button>
                          <button className={pref.played ? 'choice-pill played active' : 'choice-pill'} onClick={() => toggleDraftWorkPref(work.id, 'played')}>× やった</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )}

            {mobileSection === 'dates' && (
              <section className="editor-section compact-section">
                <div className="section-title-block"><h3>○作品の日程希望</h3><p>△・×の作品はここには表示しません。</p></div>
                {draftWantedWorks.length === 0 ? (
                  <div className="empty-mini">○にした作品がありません。作品タブで「○ やりたい」を選んでください。</div>
                ) : (
                  <div className="date-work-list">
                    {draftWantedWorks.map((work) => {
                      const dates = editorDatesMap[work.id] || []
                      return (
                        <article className="date-work-card" key={work.id}>
                          <div className="date-work-title"><strong>{work.title}</strong><span>{dates.length}候補</span></div>
                          {dates.length === 0 ? (
                            <div className="empty-mini small">この作品には候補日がありません。</div>
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

            <div className="sheet-bottom-actions sticky-save-row"><button className="primary-button wide" onClick={saveMember}>保存</button></div>
          </div>
        </div>
      )}

      {workEditorOpen && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet small-sheet">
            <div className="sheet-header"><div><h2>{workDraft.id ? '作品を編集' : '作品を追加'}</h2><p>追加作品はこのイベント内で使えます。</p></div><button className="ghost-button" onClick={() => setWorkEditorOpen(false)}>閉じる</button></div>
            <section className="editor-section compact-section">
              <label className="field-label">作品名</label>
              <input className="text-input big-input" value={workDraft.title} onChange={(e) => setWorkDraft((prev) => ({ ...prev, title: e.target.value }))} placeholder="作品名" />
              <div className="form-grid-3">
                <label><span>最少人数</span><input type="number" min="1" value={workDraft.playerMin} onChange={(e) => setWorkDraft((prev) => ({ ...prev, playerMin: e.target.value }))} /></label>
                <label><span>最大人数</span><input type="number" min="1" value={workDraft.playerMax} onChange={(e) => setWorkDraft((prev) => ({ ...prev, playerMax: e.target.value }))} /></label>
                <label><span>時間（分）</span><input type="number" min="0" value={workDraft.durationMin} onChange={(e) => setWorkDraft((prev) => ({ ...prev, durationMin: e.target.value }))} /></label>
              </div>
              <label className="field-label">メモ</label>
              <textarea className="text-area" value={workDraft.memo} onChange={(e) => setWorkDraft((prev) => ({ ...prev, memo: e.target.value }))} placeholder="補足があれば入力" />
            </section>
            <div className="sheet-bottom-actions"><button className="primary-button wide" onClick={saveWork}>保存</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
