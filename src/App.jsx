
import { useEffect, useMemo, useRef, useState } from 'react'
import worksData from './data/group-sne-works.json'
import { db } from './firebase'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
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
  return params.get('event')?.trim() || ''
}
function createMemberDraft() {
  return { id: '', name: '', notes: '', workPrefs: {}, workDatePrefs: {}, groupDatePrefs: {} }
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
    groupDatePrefs: row.groupDatePrefs || {},
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
function formatDateTime(value) {
  return value ? value.replace('T', ' ') : ''
}
function countGroupDateVotes(members, dateId) {
  const counts = { ok: 0, maybe: 0, ng: 0, none: 0 }
  members.forEach((member) => {
    const vote = member.groupDatePrefs?.[dateId]
    if (vote === 'ok') counts.ok += 1
    else if (vote === 'maybe') counts.maybe += 1
    else if (vote === 'ng') counts.ng += 1
    else counts.none += 1
  })
  return counts
}

function getTodayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}


export default function App() {
  const [eventId, setEventId] = useState(getEventIdFromUrl())
  const [eventName, setEventName] = useState('')
  const [newEventName, setNewEventName] = useState('')
  const [members, setMembers] = useState([])
  const [customWorks, setCustomWorks] = useState([])
  const [groupDates, setGroupDates] = useState([])
  const [activeTab, setActiveTab] = useState('home')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState(createMemberDraft())
  const [mobileSection, setMobileSection] = useState('summary')
  const [memberWorkSearch, setMemberWorkSearch] = useState('')
  const [workSearch, setWorkSearch] = useState('')
  const [selectedWorkId, setSelectedWorkId] = useState('')
  const [workDates, setWorkDates] = useState([])
  const [newWorkDate, setNewWorkDate] = useState(getTodayDate)
  const [newWorkHour, setNewWorkHour] = useState('13')
  const [newWorkMinute, setNewWorkMinute] = useState('00')
  const [newWorkMode, setNewWorkMode] = useState('vote')
  const [workDateCounts, setWorkDateCounts] = useState({})
  const [editorDatesMap, setEditorDatesMap] = useState({})
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [workEditorOpen, setWorkEditorOpen] = useState(false)
  const [workDraft, setWorkDraft] = useState(createWorkDraft())
  const [newGroupDate, setNewGroupDate] = useState(getTodayDate)
  const [selectedGroupDateId, setSelectedGroupDateId] = useState('')
  const [activeMemberId, setActiveMemberId] = useState('')
  const matrixHeaderScrollRef = useRef(null)
  const matrixLeftScrollRef = useRef(null)
  const [newWorkDate, setNewWorkDate] = useState(getTodayDate)
  const [newWorkHour, setNewWorkHour] = useState('13')
  const [newWorkMinute, setNewWorkMinute] = useState('00')
  const [newWorkMode, setNewWorkMode] = useState('vote')
  const [workDateCounts, setWorkDateCounts] = useState({})
  const [editorDatesMap, setEditorDatesMap] = useState({})
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [workEditorOpen, setWorkEditorOpen] = useState(false)
  const [workDraft, setWorkDraft] = useState(createWorkDraft())
  const [newGroupDate, setNewGroupDate] = useState(getTodayDate)
  const [selectedGroupDateId, setSelectedGroupDateId] = useState('')
  const [activeMemberId, setActiveMemberId] = useState('')
  const matrixHeaderScrollRef = useRef(null)
  const matrixLeftScrollRef = useRef(null)

  function syncMatrixScroll(event) {
    const target = event.currentTarget
    if (matrixHeaderScrollRef.current) matrixHeaderScrollRef.current.scrollLeft = target.scrollLeft
    if (matrixLeftScrollRef.current) matrixLeftScrollRef.current.scrollTop = target.scrollTop
  }

  const shareUrl = useMemo(() => {
    if (!eventId) return ''
    return `${window.location.origin}${window.location.pathname}?event=${eventId}`
  }, [eventId])

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
    if (!eventId) return
    const unsubscribe = onSnapshot(doc(db, 'events', eventId), (snapshot) => {
      const data = snapshot.data() || {}
      setEventName(data.name || 'マダミス調整')
    })
    return () => unsubscribe()
  }, [eventId])

  useEffect(() => {
    if (!eventId) return
    setLoadingMembers(true)
    const unsubscribe = onSnapshot(collection(db, 'events', eventId, 'members'), (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeMember({ id: row.id, ...row.data() }))
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      setMembers(rows)
      setLoadingMembers(false)
      if (!activeMemberId && rows[0]) setActiveMemberId(rows[0].id)
    })
    return () => unsubscribe()
  }, [eventId, activeMemberId])

  useEffect(() => {
    if (!eventId) return
    const unsubscribe = onSnapshot(collection(db, 'events', eventId, 'works'), (snapshot) => {
      setCustomWorks(snapshot.docs.map((row) => normalizeWork({ id: row.id, ...row.data() }, 'custom')))
    })
    return () => unsubscribe()
  }, [eventId])

  useEffect(() => {
    if (!eventId) return
    const unsubscribe = onSnapshot(collection(db, 'events', eventId, 'groupDates'), (snapshot) => {
      const rows = snapshot.docs
        .map((row) => ({ id: row.id, ...row.data() }))
        .sort((a, b) => (a.rawValue || '').localeCompare(b.rawValue || ''))
      setGroupDates(rows)
      if (!selectedGroupDateId && rows[0]) setSelectedGroupDateId(rows[0].id)
    })
    return () => unsubscribe()
  }, [eventId, selectedGroupDateId])

  useEffect(() => {
    if (!eventId || !selectedWorkId) {
      setWorkDates([])
      return
    }
    const datesRef = collection(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates')
    const unsubscribe = onSnapshot(datesRef, (snapshot) => {
      const rows = snapshot.docs
        .map((row) => ({ id: row.id, mode: 'vote', entries: {}, ...row.data() }))
        .sort((a, b) => (a.rawValue || '').localeCompare(b.rawValue || ''))
      setWorkDates(rows)
    })
    return () => unsubscribe()
  }, [eventId, selectedWorkId])

  useEffect(() => {
    if (!eventId || works.length === 0) {
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
    return works.filter((work) => {
      const pref = draft.workPrefs?.[work.id]
      return pref?.wanted && !pref?.played
    }).map((work) => work.id)
  }, [works, draft.workPrefs])

  useEffect(() => {
    if (!eventId || !editorOpen) {
      setEditorDatesMap({})
      return
    }
    setEditorDatesMap({})
    const unsubscribes = draftWantedWorkIds.map((workId) => {
      const datesRef = collection(db, 'events', eventId, 'workSchedules', workId, 'dates')
      return onSnapshot(datesRef, (snapshot) => {
        const rows = snapshot.docs
          .map((row) => ({ id: row.id, mode: 'vote', entries: {}, ...row.data() }))
          .sort((a, b) => (a.rawValue || '').localeCompare(b.rawValue || ''))
        setEditorDatesMap((prev) => ({ ...prev, [workId]: rows }))
      })
    })
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [eventId, editorOpen, draftWantedWorkIds.join('|')])

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
      const entries = date.entries || {}
      const entryIds = Object.keys(entries).filter((memberId) => entries[memberId])
      return { ...date, ok, maybe, ng, entryIds }
    })
  }, [selectedWantedMembers, selectedWorkId, workDates])

  const hasFirstComeDate = useMemo(() => workDates.some((date) => date.mode === 'firstCome'), [workDates])
  const hasVoteDate = useMemo(() => workDates.some((date) => date.mode !== 'firstCome'), [workDates])
  const canAddWorkDateByMode = useMemo(() => {
    if (newWorkMode === 'firstCome') return workDates.length === 0
    return !hasFirstComeDate
  }, [newWorkMode, workDates.length, hasFirstComeDate])
  const workDateModeMessage = useMemo(() => {
    if (hasFirstComeDate) return 'この作品は先着順で募集しています。先着順は1件のみのため、候補日は追加できません。'
    if (hasVoteDate && newWorkMode === 'firstCome') return 'この作品はすでに希望集計の候補日があります。希望集計のあとに先着順は追加できません。'
    return ''
  }, [hasFirstComeDate, hasVoteDate, newWorkMode])

  const draftWantedWorks = useMemo(() => works.filter((work) => draftWantedWorkIds.includes(work.id)), [works, draftWantedWorkIds])
  const selectedGroupDate = useMemo(() => groupDates.find((date) => date.id === selectedGroupDateId) || null, [groupDates, selectedGroupDateId])

  const possibleWorksForSelectedDate = useMemo(() => {
    if (!selectedGroupDate) return []
    const availableMembers = members.filter((member) => member.groupDatePrefs?.[selectedGroupDate.id] === 'ok')
    return works.map((work) => {
      const okMembers = availableMembers.filter((member) => {
        const pref = getWorkPref(member, work.id)
        return pref.wanted && !pref.played
      })
      let level = 'short'
      if (okMembers.length >= work.playerMin && (!work.playerMax || okMembers.length <= work.playerMax)) level = 'best'
      else if (okMembers.length >= work.playerMin) level = 'over'
      return { work, okMembers, count: okMembers.length, level }
    }).sort((a, b) => {
      const rank = { best: 0, over: 1, short: 2 }
      return rank[a.level] - rank[b.level] || b.count - a.count || a.work.title.localeCompare(b.work.title, 'ja')
    })
  }, [selectedGroupDate, members, works])

  async function createEvent() {
    const name = newEventName.trim() || 'マダミス調整'
    const ref = await addDoc(collection(db, 'events'), { name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    const url = `${window.location.origin}${window.location.pathname}?event=${ref.id}`
    window.history.replaceState(null, '', url)
    setEventId(ref.id)
    setEventName(name)
  }
  async function copyShareUrl() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    alert('共有URLをコピーしました')
  }
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
      groupDatePrefs: draft.groupDatePrefs || {},
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
    const hasFirstCome = workDates.some((date) => date.mode === 'firstCome')
    const hasVote = workDates.some((date) => date.mode !== 'firstCome')
    if (newWorkMode === 'firstCome' && workDates.length > 0) {
      alert('先着順は作品ごとに1件のみです。また、希望集計を追加したあとに先着順は追加できません。')
      return
    }
    if (newWorkMode !== 'firstCome' && hasFirstCome) {
      alert('この作品は先着順で募集しています。先着順は1件のみのため、候補日は追加できません。')
      return
    }
    if (newWorkMode === 'firstCome' && hasVote) {
      alert('この作品はすでに希望集計の候補日があります。希望集計のあとに先着順は追加できません。')
      return
    }
    const rawValue = `${newWorkDate}T${newWorkHour}:${newWorkMinute}`
    await addDoc(collection(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates'), {
      label: formatDateTime(rawValue),
      rawValue,
      mode: newWorkMode,
      entries: {},
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
        [workId]: { ...(prev.workDatePrefs?.[workId] || {}), [dateId]: status },
      },
    }))
  }
  function updateDraftGroupDateVote(dateId, status) {
    setDraft((prev) => ({ ...prev, groupDatePrefs: { ...(prev.groupDatePrefs || {}), [dateId]: status } }))
  }
  async function addGroupDate() {
    if (!newGroupDate) return
    await addDoc(collection(db, 'events', eventId, 'groupDates'), {
      label: newGroupDate,
      rawValue: newGroupDate,
      createdAt: serverTimestamp(),
    })
    setNewGroupDate('')
  }
  async function removeGroupDate(dateId) {
    if (!window.confirm('この日付候補を削除しますか？')) return
    await deleteDoc(doc(db, 'events', eventId, 'groupDates', dateId))
    if (selectedGroupDateId === dateId) setSelectedGroupDateId('')
  }
  async function updateGroupDateVote(memberId, dateId, status) {
    await updateDoc(doc(db, 'events', eventId, 'members', memberId), {
      [`groupDatePrefs.${dateId}`]: status,
      updatedAt: serverTimestamp(),
    })
  }
  async function joinFirstCome(dateRow) {
    if (!activeMemberId) {
      alert('参加者を選んでください')
      return
    }
    const ref = doc(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates', dateRow.id)
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref)
      const data = snap.data() || {}
      const entries = data.entries || {}
      if (entries[activeMemberId]) return
      const count = Object.values(entries).filter(Boolean).length
      const max = selectedWork?.playerMax || 0
      if (max && count >= max) throw new Error('満員です')
      transaction.update(ref, { [`entries.${activeMemberId}`]: true, updatedAt: serverTimestamp() })
    }).catch((err) => alert(err.message || '参加できませんでした'))
  }
  async function cancelFirstCome(dateRow, memberId = activeMemberId) {
    if (!memberId) return
    const ref = doc(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates', dateRow.id)
    await updateDoc(ref, { [`entries.${memberId}`]: false, updatedAt: serverTimestamp() })
  }

  if (!eventId) {
    return (
      <div className="app-shell landing-shell">
        <section className="hero landing-hero">
          <p className="eyebrow">Murder Mystery Planner</p>
          <h1>マダミス調整URLを作成</h1>
          <p className="hero-copy">グループごとに専用URLを発行します。別々のデータとして管理できます。</p>
          <div className="landing-form">
            <input className="text-input big-input" value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="グループ名 例：SNEマダミス会" />
            <button className="primary-button" onClick={createEvent}>新しいURLを作る</button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="hero compact-hero">
        <div>
          <p className="eyebrow">Murder Mystery Planner</p>
          <h1>{eventName}</h1>
          <p className="hero-copy">【参加者を追加】からお名前と作品の希望を入れてください。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={openAddMember}>参加者を追加</button>
          <button className="secondary-button" onClick={openAddWork}>作品を追加</button>
        </div>
      </header>

      <nav className="tab-bar" aria-label="主要タブ">
        <button className={activeTab === 'home' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('home')}>ホーム</button>
        <button className={activeTab === 'members' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('members')}>参加者</button>
        <button className={activeTab === 'works' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('works')}>作品</button>
        <button className={activeTab === 'dates' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('dates')}>日程</button>
        <button className={activeTab === 'matrix' ? 'tab-button active' : 'tab-button'} onClick={() => setActiveTab('matrix')}>希望表</button>
      </nav>

      <main className="main-content">
        {activeTab === 'home' && (
          <section className="panel-stack">
            <section className="panel slim-panel">
              <h2>今募集している作品</h2>
              <p>候補日時が入っている作品だけ表示します。</p>
              {activeRecruitments.length === 0 ? <div className="empty-mini">まだ募集はありません。作品に候補日を追加するとここに出ます。</div> : (
                <div className="compact-work-list">
                  {activeRecruitments.map(({ work, stats }) => (
                    <article className="compact-work-card" key={work.id}>
                      <button className="compact-work-main" onClick={() => { setSelectedWorkId(work.id); setActiveTab('works') }}>
                        <strong>{work.title}</strong>
                        <span>{work.playerCountText}・{work.durationMin}分・候補日{workDateCounts[work.id] || 0}件</span>
                      </button>
                      <div className="mini-stats one-line"><span className="mini-stat wanted">○{stats.wanted}</span><span className="mini-stat neutral">△{stats.neutral}</span><span className="mini-stat played">×{stats.played}</span><span className="mini-stat lend">貸{stats.lendable}</span></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="panel slim-panel">
              <h2>日付から調整</h2>
              <p>日付候補ごとに、参加できるか回答してください。<strong>希望○</strong>の人でできそうな作品を確認できます。</p>
              {groupDates.length === 0 ? <div className="empty-mini">日程タブで日付候補を追加してください。</div> : (
                <div className="date-card-list">
                  {groupDates.map((date) => {
                    const counts = countGroupDateVotes(members, date.id)
                    const possibleCount = works.filter((work) => {
                      const available = members.filter((member) => member.groupDatePrefs?.[date.id] === 'ok')
                      const ok = available.filter((member) => getWorkPref(member, work.id).wanted && !getWorkPref(member, work.id).played).length
                      return ok >= work.playerMin
                    }).length
                    return <button className="date-summary-card" key={date.id} onClick={() => { setSelectedGroupDateId(date.id); setActiveTab('dates') }}><strong>{date.label}</strong><span>○{counts.ok} △{counts.maybe} ×{counts.ng} / 開催可能 {possibleCount}件</span></button>
                  })}
                </div>
              )}
            </section>
            <section className="panel slim-panel">
              <div className="panel-title-row"><div><h2>共有URL</h2><p>このURLを参加者に送ると、同じ調整ページを開けます。</p></div><button className="secondary-button" onClick={copyShareUrl}>コピー</button></div>
              <div className="url-box">{shareUrl}</div>
            </section>
          </section>
        )}

        {activeTab === 'members' && (
          <section className="panel-stack">
            <div className="panel panel-header"><div><h2>参加者</h2><p>名前を押すと、その人の作品希望・日程希望を編集できます。</p></div><button className="primary-button" onClick={openAddMember}>参加者を追加</button></div>
            {loadingMembers ? <div className="panel empty-state"><h3>読み込み中</h3></div> : members.length === 0 ? <div className="panel empty-state"><h3>まだ参加者がいません</h3><p>最初の参加者を追加してください。</p></div> : (
              <div className="member-list-grid">
                {members.map((member) => {
                  const wantedCount = works.filter((work) => getWorkPref(member, work.id).wanted && !getWorkPref(member, work.id).played).length
                  return <article className="panel member-card compact-member" key={member.id}><button className="member-card-main" onClick={() => openEditMember(member, 'works')}><h3>{member.name}</h3><p>○作品 {wantedCount}件 / {member.notes || 'メモなし'}</p></button><div className="compact-actions action-left"><button className="small-button" onClick={() => openEditMember(member, 'summary')}>編集</button><button className="small-button danger" onClick={() => removeMember(member.id)}>削除</button></div></article>
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === 'works' && (
          <section className="panel-stack">
            <div className="panel panel-header"><div><h2>作品</h2><p>作品ごとに、希望集計または先着順で候補日を作れます。</p></div><div className="header-control-row"><input className="text-input" value={workSearch} onChange={(e) => setWorkSearch(e.target.value)} placeholder="作品名で検索" /><button className="secondary-button" onClick={openAddWork}>作品追加</button></div></div>
            {!selectedWork && <div className="compact-work-list">{visibleWorks.map((work) => { const stats = workStats.get(work.id) || { wanted: 0, neutral: 0, played: 0, lendable: 0 }; return <article className="compact-work-card" key={work.id}><button className="compact-work-main" onClick={() => setSelectedWorkId(work.id)}><strong>{work.title}</strong><span>{work.playerCountText}・{work.durationMin}分・候補日{workDateCounts[work.id] || 0}件</span></button><div className="compact-right"><div className="mini-stats one-line"><span className="mini-stat wanted">○{stats.wanted}</span><span className="mini-stat neutral">△{stats.neutral}</span><span className="mini-stat played">×{stats.played}</span><span className="mini-stat lend">貸{stats.lendable}</span></div><div className="right-actions"><button className="icon-edit" onClick={() => openEditWork(work)}>編集</button>{work.source === 'custom' && <button className="icon-edit danger" onClick={() => removeWork(work)}>削除</button>}</div></div></article> })}</div>}

            {selectedWork && <>
              <div className="panel detail-header compact-detail"><button className="ghost-button" onClick={() => setSelectedWorkId('')}>← 一覧へ</button><div className="detail-title-wrap"><h2>{selectedWork.title}</h2><p>{selectedWork.playerCountText}・{selectedWork.durationMin}分</p></div><div className="detail-status-box"><span className="detail-count">○の人: {selectedWantedMembers.length}</span></div></div>
              <div className="panel two-column-grid"><section className="sub-panel"><h3>日程調整に入る人（○のみ）</h3>{selectedWantedMembers.length === 0 ? <p>まだいません。</p> : <div className="list-stack">{selectedWantedMembers.map((member) => <button className="person-row as-button" key={member.id} onClick={() => openEditMember(member, 'dates')}><span>{member.name}</span><span className="person-tag wanted">○</span></button>)}</div>}</section><section className="sub-panel"><h3>貸し出し可能</h3>{selectedWorkLenders.length === 0 ? <p>まだいません。</p> : <div className="list-stack">{selectedWorkLenders.map((member) => <button className="person-row as-button" key={member.id} onClick={() => openEditMember(member, 'works')}><span>{member.name}</span><span className="person-tag lend">貸出可</span></button>)}</div>}</section></div>
              <div className="panel panel-header schedule-add-panel"><div><h2>この作品の候補日</h2><p>希望集計は複数追加できます。先着順は1件のみで、希望集計との混在はできません。</p></div><div className="date-add-box custom-date-box with-mode"><input type="date" value={newWorkDate} onChange={(e) => setNewWorkDate(e.target.value)} /><select value={newWorkHour} onChange={(e) => setNewWorkHour(e.target.value)} aria-label="時">{HOURS.map((hour) => <option key={hour} value={hour}>{hour}時</option>)}</select><select value={newWorkMinute} onChange={(e) => setNewWorkMinute(e.target.value)} aria-label="分">{MINUTES.map((minute) => <option key={minute} value={minute}>{minute}分</option>)}</select><select value={newWorkMode} onChange={(e) => setNewWorkMode(e.target.value)} aria-label="方式" disabled={hasFirstComeDate}><option value="vote">希望集計</option><option value="firstCome" disabled={workDates.length > 0}>先着順</option></select><button className="primary-button" onClick={addWorkDate} disabled={!newWorkDate || !canAddWorkDateByMode}>追加</button>{workDateModeMessage && <p className="mode-lock-note">{workDateModeMessage}</p>}</div></div>
              {hasFirstComeDate && <div className="active-member-picker panel slim-panel"><label className="field-label">先着順で操作する参加者</label><select value={activeMemberId} onChange={(e) => setActiveMemberId(e.target.value)}><option value="">選択</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>}
              {selectedWorkScheduleSummary.length === 0 ? <div className="panel empty-state"><h3>候補日がありません</h3><p>候補日を追加してください。</p></div> : <div className="work-date-list">{selectedWorkScheduleSummary.map((date) => { const isFirst = date.mode === 'firstCome'; const entryMembers = date.entryIds.map((id) => members.find((member) => member.id === id)).filter(Boolean); const joined = activeMemberId && date.entryIds.includes(activeMemberId); const full = selectedWork.playerMax && date.entryIds.length >= selectedWork.playerMax; return <article className="work-date-card" key={date.id}><div className="work-date-head"><div><strong>{date.label}</strong><span>{isFirst ? '先着順' : '希望集計'}</span></div><button className="table-delete" onClick={() => removeWorkDate(date.id)}>削除</button></div>{isFirst ? <div className="firstcome-box"><div className="entry-meter">{date.entryIds.length}/{selectedWork.playerMax || '-'}参加者</div><div className="entry-list">{entryMembers.length === 0 ? 'まだ参加者はいません' : entryMembers.map((member) => <span key={member.id} className="entry-chip">{member.name}</span>)}</div>{joined ? <button className="secondary-button wide" onClick={() => cancelFirstCome(date)}>キャンセルする</button> : <button className="primary-button wide" disabled={full} onClick={() => joinFirstCome(date)}>{full ? '満員です' : '参加する'}</button>}</div> : <div className="vote-grid compact-votes"><div className="mini-stats one-line"><span className="mini-stat wanted">○{date.ok}</span><span className="mini-stat neutral">△{date.maybe}</span><span className="mini-stat played">×{date.ng}</span></div>{selectedWantedMembers.map((member) => { const vote = member.workDatePrefs?.[selectedWorkId]?.[date.id] || ''; return <div className="vote-row" key={`${date.id}-${member.id}`}><span className="vote-name">{member.name}</span><div className="segmented-row">{DATE_STATUSES.map((status) => <button key={status.key} className={vote === status.key ? `segment active ${status.key}` : 'segment'} onClick={() => updateMemberDateVote(member.id, selectedWorkId, date.id, status.key)}>{status.label}</button>)}</div></div> })}</div>}</article> })}</div>}
            </>}
          </section>
        )}

        {activeTab === 'dates' && <section className="panel-stack"><div className="panel panel-header"><div><h2>日程の追加</h2><p>日程候補を追加して、その日にできる作品を表示します。</p></div><div className="date-only-add"><input type="date" value={newGroupDate} onChange={(e) => setNewGroupDate(e.target.value)} /><button className="primary-button" onClick={addGroupDate}>追加</button></div></div>{groupDates.length === 0 ? <div className="panel empty-state"><h3>日付候補がありません</h3></div> : <div className="two-column-grid"><section className="panel slim-panel"><h3>日付候補</h3><div className="date-card-list">{groupDates.map((date) => { const counts = countGroupDateVotes(members, date.id); return <button key={date.id} className={selectedGroupDateId === date.id ? 'date-summary-card active' : 'date-summary-card'} onClick={() => setSelectedGroupDateId(date.id)}><strong>{date.label}</strong><span>○{counts.ok} △{counts.maybe} ×{counts.ng}</span></button> })}</div></section><section className="panel slim-panel"><h3>{selectedGroupDate?.label || '日付'} の回答</h3>{!selectedGroupDate ? <p>日付を選んでください。</p> : <><button className="small-button danger" onClick={() => removeGroupDate(selectedGroupDate.id)}>この日付を削除</button><div className="vote-grid">{members.map((member) => { const vote = member.groupDatePrefs?.[selectedGroupDate.id] || ''; return <div className="vote-row" key={member.id}><span className="vote-name">{member.name}</span><div className="segmented-row">{DATE_STATUSES.map((status) => <button key={status.key} className={vote === status.key ? `segment active ${status.key}` : 'segment'} onClick={() => updateGroupDateVote(member.id, selectedGroupDate.id, status.key)}>{status.label}</button>)}</div></div> })}</div></>}</section></div>}{selectedGroupDate && <section className="panel slim-panel"><h2>{selectedGroupDate.label} にできる作品</h2><div className="possible-list">{possibleWorksForSelectedDate.map(({ work, okMembers, count, level }) => <article className={`possible-card ${level}`} key={work.id}><div><strong>{work.title}</strong><span>{count}人 / {work.playerCountText}・{work.durationMin}分</span></div><p>{level === 'best' ? '開催しやすい' : level === 'over' ? '人数多めだが開催可能' : `あと${Math.max(0, work.playerMin - count)}人`}</p><small>{okMembers.map((member) => member.name).join('、') || '該当者なし'}</small></article>)}</div></section>}</section>}

        {activeTab === 'matrix' && <section className="panel-stack"><div className="panel panel-header"><div><h2>希望・参加済み一覧表</h2><p>⚪︎：未通過（やりたい）、×：通過済み</p></div></div><div className="panel matrix-panel"><div className="freeze-matrix"><div className="matrix-corner-cell">作品</div><div className="matrix-top-scroll" ref={matrixHeaderScrollRef} aria-hidden="true"><table className="matrix-top-table"><thead><tr><th className="sum-col">○</th><th className="sum-col">△</th><th className="sum-col">×</th>{members.map((member) => <th key={member.id} className="member-col">{member.name}</th>)}</tr></thead></table></div><div className="matrix-left-scroll" ref={matrixLeftScrollRef} aria-hidden="true"><table className="matrix-left-table"><tbody>{visibleWorks.map((work) => <tr key={work.id}><td className="matrix-work-cell"><button className="matrix-work-link" onClick={() => { setSelectedWorkId(work.id); setActiveTab('works') }}>{work.title}</button></td></tr>)}</tbody></table></div><div className="matrix-body-scroll" onScroll={syncMatrixScroll}><table className="matrix-body-table"><tbody>{visibleWorks.map((work) => { const stats = workStats.get(work.id) || { wanted: 0, neutral: 0, played: 0 }; return <tr key={work.id}><td className="sum-cell wanted-total">{stats.wanted}</td><td className="sum-cell neutral-total">{stats.neutral}</td><td className="sum-cell played-total">{stats.played}</td>{members.map((member) => <td key={`${work.id}-${member.id}`} className={`matrix-symbol-cell ${getWorkSymbolClass(member, work.id)}`}>{getWorkSymbol(member, work.id)}</td>)}</tr> })}</tbody></table></div></div></div></section>}
      </main>

      {editorOpen && <div className="sheet-backdrop" role="dialog" aria-modal="true"><div className="sheet mobile-editor-sheet"><div className="editor-sticky-block"><div className="sheet-header sticky-sheet-header"><div><h2>{draft.id ? draft.name || '参加者を編集' : '参加者を追加'}</h2><p>基本情報・作品希望・日付希望を編集します。</p></div><button className="ghost-button" onClick={() => setEditorOpen(false)}>閉じる</button></div><div className="editor-tab-row"><button className={mobileSection === 'summary' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('summary')}>基本</button><button className={mobileSection === 'works' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('works')}>作品</button><button className={mobileSection === 'dates' ? 'editor-tab active' : 'editor-tab'} onClick={() => setMobileSection('dates')}>日程</button></div></div>{mobileSection === 'summary' && <><section className="editor-section compact-section"><label className="field-label">名前</label><input className="text-input big-input" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="名前を入力" /></section><section className="editor-section compact-section"><label className="field-label">コメント</label><textarea className="text-area big-input" value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="補足があれば入力" /></section></>}{mobileSection === 'works' && <section className="editor-section compact-section"><div className="section-title-block"><h3>未通過・参加済み状況選択</h3><p>○にした作品で調整を行います。お持ちのマダミスの貸出をしていただける方は貸出可を押してください。</p></div><input className="text-input" value={memberWorkSearch} onChange={(e) => setMemberWorkSearch(e.target.value)} placeholder="作品名で絞り込み" /><div className="works-editor-list mobile-work-list">{editorVisibleWorks.map((work) => { const pref = draft.workPrefs?.[work.id] || { played: false, wanted: false, lendable: false }; return <article className="mini-work-card mobile-work-card" key={work.id}><div className="mobile-work-head"><div><h4>{work.title}</h4><p>{work.playerCountText}・{work.durationMin}分</p></div><button className={pref.lendable ? 'small-lend-button active' : 'small-lend-button'} onClick={() => toggleDraftWorkPref(work.id, 'lendable')}>貸出可</button></div><div className="choice-circle-row compact-choice"><button className={pref.wanted ? 'choice-pill wanted active' : 'choice-pill'} onClick={() => toggleDraftWorkPref(work.id, 'wanted')}>○ やりたい</button><button className={!pref.played && !pref.wanted ? 'choice-pill neutral active' : 'choice-pill'} onClick={() => setDraft((prev) => ({ ...prev, workPrefs: { ...prev.workPrefs, [work.id]: { ...(prev.workPrefs?.[work.id] || {}), played: false, wanted: false, lendable: prev.workPrefs?.[work.id]?.lendable || false } } }))}>△ 保留</button><button className={pref.played ? 'choice-pill played active' : 'choice-pill'} onClick={() => toggleDraftWorkPref(work.id, 'played')}>× やった</button></div></article> })}</div></section>}{mobileSection === 'dates' && <section className="editor-section compact-section"><div className="section-title-block"><h3>日程希望</h3><p>全体の日付候補と、○作品の候補日に回答できます。</p></div><h4>日付だけの参加可否</h4>{groupDates.length === 0 ? <div className="empty-mini">日付候補がありません。</div> : <div className="date-vote-mobile-list">{groupDates.map((date) => { const currentVote = draft.groupDatePrefs?.[date.id] || ''; return <div className="date-vote-mobile-card compact-date" key={date.id}><div className="date-vote-label">{date.label}</div><div className="date-circle-buttons compact-date-buttons">{DATE_STATUSES.map((status) => <button key={status.key} className={currentVote === status.key ? `date-pill active ${status.key}` : `date-pill ${status.key}`} onClick={() => updateDraftGroupDateVote(date.id, status.key)}>{status.label}</button>)}</div></div> })}</div>}<h4>○作品の候補日</h4>{draftWantedWorks.length === 0 ? <div className="empty-mini">○にした作品がありません。</div> : <div className="date-work-list">{draftWantedWorks.map((work) => { const dates = (editorDatesMap[work.id] || []).filter((date) => date.mode !== 'firstCome'); return <article className="date-work-card" key={work.id}><div className="date-work-title"><strong>{work.title}</strong><span>{dates.length}候補</span></div>{dates.length === 0 ? <div className="empty-mini small">希望集計の候補日がありません。</div> : <div className="date-vote-mobile-list">{dates.map((date) => { const currentVote = draft.workDatePrefs?.[work.id]?.[date.id] || ''; return <div className="date-vote-mobile-card compact-date" key={date.id}><div className="date-vote-label">{date.label}</div><div className="date-circle-buttons compact-date-buttons">{DATE_STATUSES.map((status) => <button key={status.key} className={currentVote === status.key ? `date-pill active ${status.key}` : `date-pill ${status.key}`} onClick={() => updateDraftDateVote(work.id, date.id, status.key)}>{status.label}</button>)}</div></div> })}</div>}</article> })}</div>}</section>}<div className="sheet-bottom-actions sticky-save-row"><button className="primary-button wide" onClick={saveMember}>保存</button></div></div></div>}

      {workEditorOpen && <div className="sheet-backdrop" role="dialog" aria-modal="true"><div className="sheet small-sheet"><div className="sheet-header"><div><h2>{workDraft.id ? '作品を編集' : '作品を追加'}</h2><p>希望の作品があればここから追加してください。</p></div><button className="ghost-button" onClick={() => setWorkEditorOpen(false)}>閉じる</button></div><section className="editor-section compact-section"><label className="field-label">作品名</label><input className="text-input big-input" value={workDraft.title} onChange={(e) => setWorkDraft((prev) => ({ ...prev, title: e.target.value }))} placeholder="作品名" /><div className="form-grid-3"><label><span>最少人数</span><input type="number" min="1" value={workDraft.playerMin} onChange={(e) => setWorkDraft((prev) => ({ ...prev, playerMin: e.target.value }))} /></label><label><span>最大人数</span><input type="number" min="1" value={workDraft.playerMax} onChange={(e) => setWorkDraft((prev) => ({ ...prev, playerMax: e.target.value }))} /></label><label><span>時間（分）</span><input type="number" min="0" value={workDraft.durationMin} onChange={(e) => setWorkDraft((prev) => ({ ...prev, durationMin: e.target.value }))} /></label></div><label className="field-label">メモ</label><textarea className="text-area" value={workDraft.memo} onChange={(e) => setWorkDraft((prev) => ({ ...prev, memo: e.target.value }))} placeholder="補足があれば入力" /></section><div className="sheet-bottom-actions"><button className="primary-button wide" onClick={saveWork}>保存</button></div></div></div>}
    </div>
  )
}
