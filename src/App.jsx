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
  const [eventId] = useState(getEventIdFromUrl())
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

  useEffect(() => {
    if (!editorOpen) return

    const scrollY = window.scrollY

    document.documentElement.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    document.body.style.height = '100%'
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'

    return () => {
      const top = document.body.style.top
      const restoreY = top ? Math.abs(parseInt(top, 10)) : 0

      document.documentElement.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.width = ''
      document.body.style.height = ''
      document.body.style.overflow = ''
      document.body.style.touchAction = ''

      window.scrollTo(0, restoreY)
    }
  }, [editorOpen])

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

      if (key === 'played' && next.played) next.wanted = false
      if (key === 'wanted' && next.wanted) next.played = false

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

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Group SNE Murder Mystery Planner</p>
          <h1>参加者・作品・調整マトリックス</h1>
          <p className="hero-copy">
            参加者追加、作品一覧、希望状況マトリックス、作品別の日程調整を見やすくまとめた版です。
          </p>
        </div>

        <div className="hero-stats">
          <article className="stat-card">
            <span>参加者</span>
            <strong>{members.length}</strong>
          </article>
          <article className="stat-card">
            <span>作品数</span>
            <strong>{works.length}</strong>
          </article>
          
        </div>
      </header>

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
        <button
          className={activeTab === 'matrix' ? 'tab-button active' : 'tab-button'}
          onClick={() => setActiveTab('matrix')}
        >
          希望マトリックス
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'members' && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div>
                <h2>参加者</h2>
                <p>まず人を登録し、その人ごとに作品の状況を設定します。</p>
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
                </article>
              ))
            )}
          </section>
        )}

        {activeTab === 'works' && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div>
                <h2>作品一覧</h2>
                <p>作品をタップすると、その作品の希望者・貸出可・日程調整が見られます。</p>
              </div>
              <input
                className="text-input"
                value={workSearch}
                onChange={(e) => setWorkSearch(e.target.value)}
                placeholder="作品名で検索"
              />
            </div>

            {!selectedWork && visibleWorks.map((work) => {
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
                </button>
              )
            })}

            {selectedWork && (
              <>
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
                    <p>添付イメージのように、候補日ごとの ○ △ × 集計を表で見られるようにしています。</p>
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
                  <div className="panel">
                    <div className="matrix-wrap">
                      <table className="summary-table">
                        <thead>
                          <tr>
                            <th>日程</th>
                            <th>○</th>
                            <th>△</th>
                            <th>×</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedWorkScheduleSummary.map((date) => (
                            <tr key={date.id}>
                              <td>{date.label}</td>
                              <td>{date.ok}人</td>
                              <td>{date.maybe}人</td>
                              <td>{date.ng}人</td>
                              <td>
                                <button
                                  className="table-delete"
                                  onClick={() => removeWorkDate(date.id)}
                                >
                                  削除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="vote-grid">
                      {selectedWorkScheduleSummary.map((date) => (
                        <div className="vote-block" key={date.id}>
                          <h3>{date.label}</h3>
                          {members.map((member) => {
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
    <div className="panel panel-header">
      <div>
        <h2>希望マトリックス</h2>
        <p>作品名と合計は固定、個別だけ横スクロールで確認できます。</p>
      </div>
    </div>

    <div className="panel matrix-panel">
      <div className="matrix-hint">
        <span>← 右側だけ横にスライドして個別状況を確認</span>
      </div>

      <div className="split-matrix">
        <div className="matrix-fixed">
          <table className="fixed-table">
            <thead>
              <tr>
                <th className="work-head-fixed">作品</th>
                <th className="sum-head">○</th>
                <th className="sum-head">△</th>
                <th className="sum-head">×</th>
              </tr>
            </thead>
            <tbody>
              {visibleWorks.map((work) => {
                let wantedCount = 0
                let neutralCount = 0
                let playedCount = 0

                members.forEach((member) => {
                  const symbol = getWorkSymbol(member, work.id)
                  if (symbol === '○') wantedCount += 1
                  else if (symbol === '×') playedCount += 1
                  else neutralCount += 1
                })

                return (
                  <tr key={`fixed-${work.id}`}>
                    <td className="work-title-fixed">
                      <button
                        className="matrix-work-link"
                        onClick={() => {
                          setSelectedWorkId(work.id)
                          setActiveTab('works')
                        }}
                      >
                        {work.title}
                      </button>
                    </td>
                    <td className="sum-cell wanted-total">{wantedCount}</td>
                    <td className="sum-cell neutral-total">{neutralCount}</td>
                    <td className="sum-cell played-total">{playedCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="matrix-scroll">
          <table className="scroll-table">
            <thead>
              <tr>
                {members.map((member) => (
                  <th key={member.id} className="member-head-cell horizontal-name">
                    {member.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleWorks.map((work) => (
                <tr key={`scroll-${work.id}`}>
                  {members.map((member) => (
                    <td
                      key={`${work.id}-${member.id}`}
                      className={`matrix-symbol-cell ${getWorkSymbolClass(member, work.id)}`}
                    >
                      {getWorkSymbol(member, work.id)}
                    </td>
                  ))}
                </tr>
              ))}
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
            <div className="sheet-header">
              <div>
                <h2>{draft.id ? '参加者を編集する' : '参加者を追加する'}</h2>
                <p>スマホで押しやすい大きさで、作品希望と日程希望を入力できます。</p>
              </div>
              <button className="ghost-button" onClick={() => setEditorOpen(false)}>
                閉じる
              </button>
            </div>

            <section className="editor-section compact-section">
              <label className="field-label">名前</label>
              <input
                className="text-input big-input"
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="名前を入力"
              />
            </section>

            <section className="editor-section compact-section">
              <div className="section-title-block">
                <h3>作品の希望状況</h3>
                <p>やった / やりたい / どちらでもない を作品ごとに選びます。</p>
              </div>

              <input
                className="text-input"
                value={workSearch}
                onChange={(e) => setWorkSearch(e.target.value)}
                placeholder="作品名で絞り込み"
              />

              <div className="works-editor-list mobile-work-list">
                {visibleWorks.map((work) => {
                  const pref = draft.workPrefs?.[work.id] || {
                    played: false,
                    wanted: false,
                    lendable: false,
                  }

                  return (
                    <article className="mini-work-card mobile-work-card" key={work.id}>
                      <div className="mobile-work-head">
                        <div>
                          <h4>{work.title}</h4>
                          <p>{work.playerCountText}・{work.durationMin}分</p>
                        </div>
                        <button
                          className={pref.lendable ? 'small-lend-button active' : 'small-lend-button'}
                          onClick={() => toggleDraftWorkPref(work.id, 'lendable')}
                        >
                          貸出可
                        </button>
                      </div>

                      <div className="choice-circle-row">
                        <button
                          className={pref.wanted ? 'choice-circle wanted active' : 'choice-circle'}
                          onClick={() => toggleDraftWorkPref(work.id, 'wanted')}
                        >
                          ○
                        </button>
                        <button
                          className={!pref.played && !pref.wanted ? 'choice-circle neutral active' : 'choice-circle'}
                          onClick={() => {
                            setDraft((prev) => ({
                              ...prev,
                              workPrefs: {
                                ...prev.workPrefs,
                                [work.id]: {
                                  ...(prev.workPrefs?.[work.id] || {}),
                                  played: false,
                                  wanted: false,
                                  lendable: prev.workPrefs?.[work.id]?.lendable || false,
                                },
                              },
                            }))
                          }}
                        >
                          △
                        </button>
                        <button
                          className={pref.played ? 'choice-circle played active' : 'choice-circle'}
                          onClick={() => toggleDraftWorkPref(work.id, 'played')}
                        >
                          ×
                        </button>
                      </div>

                      <div className="choice-label-row">
                        <span>やりたい</span>
                        <span>保留</span>
                        <span>やった</span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>

            {selectedWork && workDates.length > 0 && (
              <section className="editor-section compact-section">
                <div className="section-title-block">
                  <h3>「{selectedWork.title}」の日程希望</h3>
                  <p>参考画像のように、○ / △ / × をそのまま押して入力します。</p>
                </div>

                <div className="date-vote-mobile-list">
                  {workDates.map((date) => {
                    const currentVote = draft.workDatePrefs?.[selectedWorkId]?.[date.id] || ''

                    return (
                      <div className="date-vote-mobile-card" key={date.id}>
                        <div className="date-vote-label">{date.label}</div>

                        <div className="date-circle-buttons">
                          {DATE_STATUSES.map((status) => (
                            <button
                              key={status.key}
                              className={
                                currentVote === status.key
                                  ? `date-circle-button active ${status.key}`
                                  : `date-circle-button ${status.key}`
                              }
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  workDatePrefs: {
                                    ...prev.workDatePrefs,
                                    [selectedWorkId]: {
                                      ...(prev.workDatePrefs?.[selectedWorkId] || {}),
                                      [date.id]: status.key,
                                    },
                                  },
                                }))
                              }
                            >
                              {status.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            <section className="editor-section compact-section">
              <label className="field-label">コメント</label>
              <textarea
                className="text-area big-input"
                value={draft.notes}
                onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="補足があれば入力"
              />
            </section>

            <div className="mobile-save-bar">
              <button className="mobile-save-button" onClick={saveMember}>
                入力する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}