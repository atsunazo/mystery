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

const works = [...worksData.works].sort((a, b) => a.displayOrder - b.displayOrder)

const DATE_STATUSES = [
  { key: 'ok', label: '○' },
  { key: 'maybe', label: '△' },
  { key: 'ng', label: '×' },
]

function getEventIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('event')?.trim() || 'default-event'
}

function createMemberDraft() {
  return {
    id: '',
    name: '',
    notes: '',
    workPrefs: {},
    workDatePrefs: {},
  }
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

function getWorkPref(member, workId) {
  return member.workPrefs?.[workId] || {
    played: false,
    wanted: false,
    lendable: false,
  }
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
  if (count < work.playerMin) {
    return `開催まであと ${work.playerMin - count} 人必要`
  }
  if (count > work.playerMax) {
    return `${count - work.playerMax} 人多い`
  }
  return '人数条件を満たしています'
}

export default function App() {
  const [eventId, setEventId] = useState(getEventIdFromUrl())
  const [eventInput, setEventInput] = useState(getEventIdFromUrl())
  const [members, setMembers] = useState([])
  const [activeTab, setActiveTab] = useState('members')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState(createMemberDraft())
  const [workSearch, setWorkSearch] = useState('')
  const [selectedWorkId, setSelectedWorkId] = useState('')
  const [workDates, setWorkDates] = useState([])
  const [newWorkDate, setNewWorkDate] = useState('')
  const [loadingMembers, setLoadingMembers] = useState(true)

  useEffect(() => {
    setLoadingMembers(true)

    const membersRef = collection(db, 'events', eventId, 'members')
    const unsubscribe = onSnapshot(membersRef, (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeMember({ id: row.id, ...row.data() }))
        .sort((a, b) => {
          const aTime = a.createdAt?.seconds || 0
          const bTime = b.createdAt?.seconds || 0
          return aTime - bTime
        })

      setMembers(rows)
      setLoadingMembers(false)
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
        .map((row) => ({
          id: row.id,
          ...row.data(),
        }))
        .sort((a, b) => {
          const aValue = a.rawValue || ''
          const bValue = b.rawValue || ''
          return aValue.localeCompare(bValue)
        })

      setWorkDates(rows)
    })

    return () => unsubscribe()
  }, [eventId, selectedWorkId])

  const visibleWorks = useMemo(() => {
    const keyword = workSearch.trim().toLowerCase()
    if (!keyword) return works
    return works.filter((work) => work.title.toLowerCase().includes(keyword))
  }, [workSearch])

  const selectedWork = useMemo(() => {
    return works.find((work) => work.id === selectedWorkId) || null
  }, [selectedWorkId])

  const selectedWorkInterestedMembers = useMemo(() => {
    if (!selectedWorkId) return []
    return members.filter((member) => {
      const pref = getWorkPref(member, selectedWorkId)
      return !pref.played && pref.wanted
    })
  }, [members, selectedWorkId])

  const selectedWorkLenders = useMemo(() => {
    if (!selectedWorkId) return []
    return members.filter((member) => {
      const pref = getWorkPref(member, selectedWorkId)
      return pref.lendable
    })
  }, [members, selectedWorkId])

  const selectedWorkScheduleSummary = useMemo(() => {
    return workDates.map((date) => {
      let ok = 0
      let maybe = 0
      let ng = 0

      members.forEach((member) => {
        const vote = member.workDatePrefs?.[selectedWorkId]?.[date.id]
        if (vote === 'ok') ok += 1
        else if (vote === 'maybe') maybe += 1
        else if (vote === 'ng') ng += 1
      })

      return { ...date, ok, maybe, ng }
    })
  }, [members, selectedWorkId, workDates])

  function openAddMember() {
    setDraft(createMemberDraft())
    setWorkSearch('')
    setEditorOpen(true)
  }

  function openEditMember(member) {
    setDraft(JSON.parse(JSON.stringify(member)))
    setWorkSearch('')
    setEditorOpen(true)
  }

  function toggleDraftWorkPref(workId, key) {
    setDraft((prev) => {
      const current = prev.workPrefs?.[workId] || {
        played: false,
        wanted: false,
        lendable: false,
      }

      const next = {
        ...current,
        [key]: !current[key],
      }

      if (key === 'played' && next.played) {
        next.wanted = false
      }
      if (key === 'wanted' && next.wanted) {
        next.played = false
      }

      return {
        ...prev,
        workPrefs: {
          ...prev.workPrefs,
          [workId]: next,
        },
      }
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

    if (draft.id) {
      await updateDoc(doc(db, 'events', eventId, 'members', draft.id), payload)
    } else {
      await addDoc(collection(db, 'events', eventId, 'members'), {
        ...payload,
        createdAt: serverTimestamp(),
      })
    }

    setEditorOpen(false)
  }

  async function removeMember(memberId) {
    if (!window.confirm('この参加者を削除しますか？')) return
    await deleteDoc(doc(db, 'events', eventId, 'members', memberId))
  }

  async function addWorkDate() {
    if (!selectedWorkId || !newWorkDate) return

    await addDoc(collection(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates'), {
      label: newWorkDate.replace('T', ' '),
      rawValue: newWorkDate,
      createdAt: serverTimestamp(),
    })

    setNewWorkDate('')
  }

  async function removeWorkDate(dateId) {
    if (!selectedWorkId) return
    if (!window.confirm('この候補日を削除しますか？')) return

    await deleteDoc(doc(db, 'events', eventId, 'workSchedules', selectedWorkId, 'dates', dateId))
  }

  async function updateMemberDateVote(memberId, dateId, status) {
    if (!selectedWorkId) return

    await updateDoc(doc(db, 'events', eventId, 'members', memberId), {
      [`workDatePrefs.${selectedWorkId}.${dateId}`]: status,
      updatedAt: serverTimestamp(),
    })
  }

  function moveToEvent() {
    const nextEventId = eventInput.trim()
    if (!nextEventId) {
      alert('募集IDを入力してください')
      return
    }

    const nextUrl = `${window.location.pathname}?event=${encodeURIComponent(nextEventId)}`
    window.history.replaceState({}, '', nextUrl)
    setEventId(nextEventId)
    setSelectedWorkId('')
    setActiveTab('members')
    setEditorOpen(false)
  }

  async function copyShareUrl() {
    const shareUrl = `${window.location.origin}${window.location.pathname}?event=${encodeURIComponent(eventId)}`
    try {
      await navigator.clipboard.writeText(shareUrl)
      alert('共有URLをコピーしました')
    } catch {
      alert(shareUrl)
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Group SNE Murder Mystery Planner</p>
          <h1>作品別調整版</h1>
          <p className="hero-copy">
            人を追加してから、各作品ごとに「やった / やりたい / 貸出可」を登録する流れです。
          </p>
        </div>

        <div className="hero-stats">
          <article className="stat-card">
            <span>募集ID</span>
            <strong>{eventId}</strong>
          </article>
          <article className="stat-card">
            <span>参加者</span>
            <strong>{members.length}</strong>
          </article>
          <article className="stat-card">
            <span>選択作品</span>
            <strong>{selectedWork ? selectedWork.title : '未選択'}</strong>
          </article>
        </div>
      </header>

      <section className="panel event-switcher">
        <div>
          <h2>募集を切り替える</h2>
          <p>URLごとに別募集として分かれます。</p>
        </div>

        <div className="event-switcher-row">
          <input
            className="text-input"
            value={eventInput}
            onChange={(e) => setEventInput(e.target.value)}
            placeholder="募集IDを入力"
          />
          <button className="primary-button" onClick={moveToEvent}>
            開く
          </button>
          <button className="ghost-button" onClick={copyShareUrl}>
            URLをコピー
          </button>
        </div>
      </section>

      <nav className="tab-bar" aria-label="主要タブ">
        <button
          className={activeTab === 'members' ? 'tab-button active' : 'tab-button'}
          onClick={() => setActiveTab('members')}
        >
          参加者
        </button>
        <button
          className={activeTab === 'works' ? 'tab-button active' : 'tab-button'}
          onClick={() => setActiveTab('works')}
        >
          作品一覧
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'members' && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div>
                <h2>参加者を先に登録</h2>
                <p>追加後に、その人がやっていない作品ややりたい作品をまとめて設定します。</p>
              </div>
              <button className="primary-button" onClick={openAddMember}>
                参加者を追加
              </button>
            </div>

            {loadingMembers ? (
              <div className="panel empty-state">
                <h3>読み込み中</h3>
                <p>参加者データを取得しています。</p>
              </div>
            ) : members.length === 0 ? (
              <div className="panel empty-state">
                <h3>まだ参加者がいません</h3>
                <p>最初の1人を追加してください。</p>
              </div>
            ) : (
              members.map((member) => (
                <article className="panel member-card" key={member.id}>
                  <div className="member-head">
                    <div>
                      <h3>{member.name}</h3>
                      <p>{member.notes || 'メモなし'}</p>
                    </div>
                    <div className="member-actions">
                      <button className="ghost-button" onClick={() => openEditMember(member)}>
                        編集
                      </button>
                      <button className="ghost-button danger" onClick={() => removeMember(member.id)}>
                        削除
                      </button>
                    </div>
                  </div>

                  <div className="member-summary-row">
                    {works.slice(0, 6).map((work) => (
                      <span
                        key={work.id}
                        className={`mini-status ${getWorkSymbolClass(member, work.id)}`}
                        title={work.title}
                      >
                        {work.title.slice(0, 6)} {getWorkSymbol(member, work.id)}
                      </span>
                    ))}
                  </div>
                </article>
              ))
            )}
          </section>
        )}

        {activeTab === 'works' && !selectedWork && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div>
                <h2>作品一覧</h2>
                <p>× はやった、○ はやりたい、△ はどちらでもない人です。</p>
              </div>
              <input
                className="text-input"
                value={workSearch}
                onChange={(e) => setWorkSearch(e.target.value)}
                placeholder="作品名で検索"
              />
            </div>

            {visibleWorks.map((work) => {
              const interested = members.filter((member) => {
                const pref = getWorkPref(member, work.id)
                return !pref.played && pref.wanted
              }).length

              const lenders = members.filter((member) => {
                const pref = getWorkPref(member, work.id)
                return pref.lendable
              }).length

              return (
                <button
                  key={work.id}
                  className="panel work-card-button"
                  onClick={() => setSelectedWorkId(work.id)}
                >
                  <div className="work-head">
                    <div>
                      <h3>{work.title}</h3>
                      <p>{work.playerCountText}・{work.durationMin}分</p>
                    </div>
                    <span className="work-open">開く</span>
                  </div>

                  <div className="chip-row">
                    <span className="chip wanted">○ {interested}</span>
                    <span className="chip lend">貸出可 {lenders}</span>
                  </div>

                  <div className="symbol-list">
                    {members.length === 0 ? (
                      <span className="empty-inline">参加者未登録</span>
                    ) : (
                      members.map((member) => (
                        <span
                          key={member.id}
                          className={`symbol-badge ${getWorkSymbolClass(member, work.id)}`}
                        >
                          {member.name} {getWorkSymbol(member, work.id)}
                        </span>
                      ))
                    )}
                  </div>
                </button>
              )
            })}
          </section>
        )}

        {activeTab === 'works' && selectedWork && (
          <section className="panel-stack">
            <div className="panel detail-header">
              <button className="ghost-button" onClick={() => setSelectedWorkId('')}>
                ← 作品一覧へ戻る
              </button>

              <div className="detail-title-wrap">
                <h2>{selectedWork.title}</h2>
                <p>{selectedWork.playerCountText}・{selectedWork.durationMin}分</p>
              </div>

              <div className="detail-status-box">
                <span className="detail-count">○ の人: {selectedWorkInterestedMembers.length}</span>
                <span className="detail-message">
                  {getCandidateMessage(selectedWork, selectedWorkInterestedMembers.length)}
                </span>
              </div>
            </div>

            <div className="panel two-column-grid">
              <section className="sub-panel">
                <h3>やりたい人</h3>
                {selectedWorkInterestedMembers.length === 0 ? (
                  <p>まだいません。</p>
                ) : (
                  <div className="list-stack">
                    {selectedWorkInterestedMembers.map((member) => (
                      <div className="person-row" key={member.id}>
                        <span>{member.name}</span>
                        <span className="person-tag wanted">○</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="sub-panel">
                <h3>貸し出し可能</h3>
                {selectedWorkLenders.length === 0 ? (
                  <p>まだいません。</p>
                ) : (
                  <div className="list-stack">
                    {selectedWorkLenders.map((member) => (
                      <div className="person-row" key={member.id}>
                        <span>{member.name}</span>
                        <span className="person-tag lend">貸出可</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="panel panel-header">
              <div>
                <h2>この作品の日程調整</h2>
                <p>候補日ごとに、参加者ごとの ○ / △ / × を付けます。</p>
              </div>

              <div className="date-add-box">
                <input
                  type="datetime-local"
                  value={newWorkDate}
                  onChange={(e) => setNewWorkDate(e.target.value)}
                />
                <button className="primary-button" onClick={addWorkDate}>
                  候補日を追加
                </button>
              </div>
            </div>

            {selectedWorkScheduleSummary.length === 0 ? (
              <div className="panel empty-state">
                <h3>候補日がありません</h3>
                <p>この作品用の候補日を追加してください。</p>
              </div>
            ) : (
              selectedWorkScheduleSummary.map((date) => (
                <article className="panel schedule-card" key={date.id}>
                  <div className="member-head">
                    <div>
                      <h3>{date.label}</h3>
                      <p>作品「{selectedWork.title}」専用の候補日です。</p>
                    </div>
                    <button className="ghost-button danger" onClick={() => removeWorkDate(date.id)}>
                      削除
                    </button>
                  </div>

                  <div className="chip-row">
                    <span className="chip ok">○ {date.ok}</span>
                    <span className="chip maybe">△ {date.maybe}</span>
                    <span className="chip ng">× {date.ng}</span>
                  </div>

                  <div className="vote-grid">
                    {members.length === 0 ? (
                      <p>参加者がいません。</p>
                    ) : (
                      members.map((member) => {
                        const vote = member.workDatePrefs?.[selectedWorkId]?.[date.id] || ''
                        return (
                          <div className="vote-row" key={`${date.id}-${member.id}`}>
                            <span className="vote-name">{member.name}</span>
                            <div className="segmented-row">
                              {DATE_STATUSES.map((status) => (
                                <button
                                  key={status.key}
                                  className={vote === status.key ? 'segment active' : 'segment'}
                                  onClick={() => updateMemberDateVote(member.id, date.id, status.key)}
                                >
                                  {status.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
        )}
      </main>

      {editorOpen && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet">
            <div className="sheet-header">
              <div>
                <h2>{draft.id ? '参加者を編集' : '参加者を追加'}</h2>
                <p>最初に人を登録し、そのあと作品ごとの状態をまとめて設定します。</p>
              </div>
              <button className="ghost-button" onClick={() => setEditorOpen(false)}>
                閉じる
              </button>
            </div>

            <section className="editor-section">
              <label className="field-label">名前</label>
              <input
                className="text-input"
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="名前を入力"
              />

              <label className="field-label">メモ</label>
              <textarea
                className="text-area"
                value={draft.notes}
                onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="補足があれば入力"
              />
            </section>

            <section className="editor-section">
              <div className="section-head-inline">
                <h3>作品設定</h3>
                <input
                  className="text-input"
                  value={workSearch}
                  onChange={(e) => setWorkSearch(e.target.value)}
                  placeholder="作品名で絞り込み"
                />
              </div>

              <div className="works-editor-list">
                {visibleWorks.map((work) => {
                  const pref = draft.workPrefs?.[work.id] || {
                    played: false,
                    wanted: false,
                    lendable: false,
                  }

                  return (
                    <article className="mini-work-card" key={work.id}>
                      <div>
                        <h4>{work.title}</h4>
                        <p>{work.playerCountText}・{work.durationMin}分</p>
                      </div>

                      <div className="toggle-grid">
                        <button
                          className={pref.played ? 'toggle-pill active played' : 'toggle-pill'}
                          onClick={() => toggleDraftWorkPref(work.id, 'played')}
                        >
                          やった
                        </button>
                        <button
                          className={pref.wanted ? 'toggle-pill active wanted' : 'toggle-pill'}
                          onClick={() => toggleDraftWorkPref(work.id, 'wanted')}
                        >
                          やりたい
                        </button>
                        <button
                          className={pref.lendable ? 'toggle-pill active lend' : 'toggle-pill'}
                          onClick={() => toggleDraftWorkPref(work.id, 'lendable')}
                        >
                          貸出可
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>

            <div className="sheet-actions">
              <button className="ghost-button" onClick={() => setEditorOpen(false)}>
                キャンセル
              </button>
              <button className="primary-button" onClick={saveMember}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}