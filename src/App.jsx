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

const WORK_STATUSES = [
  { key: 'unknown', label: '未設定' },
  { key: 'played', label: 'やった' },
  { key: 'wanted', label: 'やりたい' },
]

const DATE_STATUSES = [
  { key: 'ok', label: '○' },
  { key: 'maybe', label: '△' },
  { key: 'ng', label: '×' },
]

const works = [...worksData.works].sort((a, b) => a.displayOrder - b.displayOrder)
const eventId =
  new URLSearchParams(window.location.search).get('event') || 'default-event'

function createMember() {
  return {
    id: '',
    name: '',
    notes: '',
    workStatuses: {},
    availability: {},
  }
}

function countStatuses(member) {
  const values = Object.values(member.workStatuses || {})
  return {
    played: values.filter((v) => v === 'played').length,
    wanted: values.filter((v) => v === 'wanted').length,
  }
}

export default function App() {
  const [members, setMembers] = useState([])
  const [dates, setDates] = useState([])
  const [activeTab, setActiveTab] = useState('members')
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState(createMember())
  const [workFilter, setWorkFilter] = useState('all')
  const [newDate, setNewDate] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const membersRef = collection(db, 'events', eventId, 'members')
    const datesRef = collection(db, 'events', eventId, 'dates')

    const unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
      const rows = snapshot.docs
        .map((row) => ({
          id: row.id,
          ...row.data(),
          workStatuses: row.data().workStatuses || {},
          availability: row.data().availability || {},
        }))
        .sort((a, b) => {
          const aTime = a.createdAt?.seconds || 0
          const bTime = b.createdAt?.seconds || 0
          return aTime - bTime
        })
      setMembers(rows)
      setLoading(false)
    })

    const unsubscribeDates = onSnapshot(datesRef, (snapshot) => {
      const rows = snapshot.docs
        .map((row) => ({
          id: row.id,
          ...row.data(),
        }))
        .sort((a, b) => {
          const aTime = a.createdAt?.seconds || 0
          const bTime = b.createdAt?.seconds || 0
          return aTime - bTime
        })
      setDates(rows)
    })

    return () => {
      unsubscribeMembers()
      unsubscribeDates()
    }
  }, [])

  const worksWithPeople = useMemo(() => {
    return works.map((work) => {
      const playedBy = members
        .filter((m) => m.workStatuses?.[work.id] === 'played')
        .map((m) => m.name || '未入力')

      const wantedBy = members
        .filter((m) => m.workStatuses?.[work.id] === 'wanted')
        .map((m) => m.name || '未入力')

      return { ...work, playedBy, wantedBy }
    })
  }, [members])

  const scheduleSummary = useMemo(() => {
    return dates.map((date) => {
      let ok = 0
      let maybe = 0
      let ng = 0

      members.forEach((member) => {
        const value = member.availability?.[date.id]
        if (value === 'ok') ok += 1
        else if (value === 'maybe') maybe += 1
        else if (value === 'ng') ng += 1
      })

      return { ...date, ok, maybe, ng }
    })
  }, [dates, members])

  const filteredWorks = useMemo(() => {
    if (workFilter === 'all') return works
    return works.filter(
      (work) => (draft.workStatuses?.[work.id] || 'unknown') === workFilter
    )
  }, [draft, workFilter])

  function openAddMember() {
    setDraft(createMember())
    setWorkFilter('all')
    setEditorOpen(true)
  }

  function openEditMember(member) {
    setDraft(JSON.parse(JSON.stringify(member)))
    setWorkFilter('all')
    setEditorOpen(true)
  }

  async function saveMember() {
    if (!draft.name.trim()) {
      alert('参加者名を入力してください')
      return
    }

    const payload = {
      name: draft.name.trim(),
      notes: draft.notes || '',
      workStatuses: draft.workStatuses || {},
      availability: draft.availability || {},
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

  function updateWorkStatus(workId, status) {
    setDraft((prev) => ({
      ...prev,
      workStatuses: {
        ...prev.workStatuses,
        [workId]: status,
      },
    }))
  }

  function updateDateStatus(dateId, status) {
    setDraft((prev) => ({
      ...prev,
      availability: {
        ...prev.availability,
        [dateId]: status,
      },
    }))
  }

  async function addDate() {
    if (!newDate) return

    await addDoc(collection(db, 'events', eventId, 'dates'), {
      label: newDate.replace('T', ' '),
      rawValue: newDate,
      createdAt: serverTimestamp(),
    })

    setNewDate('')
  }

  async function removeDate(dateId) {
    if (!window.confirm('この候補日を削除しますか？')) return
    await deleteDoc(doc(db, 'events', eventId, 'dates', dateId))
  }

  const memberCount = members.length
  const playedTotal = members.reduce(
    (sum, member) => sum + countStatuses(member).played,
    0
  )
  const wantedTotal = members.reduce(
    (sum, member) => sum + countStatuses(member).wanted,
    0
  )

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Group SNE Murder Mystery Planner</p>
          <h1>グループSNEマダミス調整</h1>
          <p className="hero-copy">
            参加者の追加・編集、作品状況、候補日調整を Firestore に保存する版です。
          </p>
          <p className="hero-copy">共有URL用イベントID: {eventId}</p>
        </div>

        <div className="hero-stats">
          <article className="stat-card">
            <span>参加者</span>
            <strong>{memberCount}</strong>
          </article>
          <article className="stat-card">
            <span>やった登録</span>
            <strong>{playedTotal}</strong>
          </article>
          <article className="stat-card">
            <span>やりたい登録</span>
            <strong>{wantedTotal}</strong>
          </article>
        </div>
      </header>

      <nav className="tab-bar" aria-label="主要タブ">
        {[
          ['members', '参加者'],
          ['works', '作品一覧'],
          ['schedule', '日程調整'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={activeTab === key ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activeTab === 'members' && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div>
                <h2>参加者</h2>
                <p>追加・編集内容は Firestore に保存されます。</p>
              </div>
              <button className="primary-button" onClick={openAddMember}>
                参加者を追加
              </button>
            </div>

            {loading ? (
              <div className="panel empty-state">
                <h3>読み込み中</h3>
                <p>Firestore から参加者を取得しています。</p>
              </div>
            ) : members.length === 0 ? (
              <div className="panel empty-state">
                <h3>まだ参加者がいません</h3>
                <p>最初の1人を追加してください。</p>
              </div>
            ) : (
              members.map((member) => {
                const counts = countStatuses(member)
                return (
                  <article className="panel member-card" key={member.id}>
                    <div className="member-head">
                      <div>
                        <h3>{member.name}</h3>
                        <p>{member.notes || 'メモなし'}</p>
                      </div>
                      <div className="member-actions">
                        <button
                          className="ghost-button"
                          onClick={() => openEditMember(member)}
                        >
                          編集
                        </button>
                        <button
                          className="ghost-button danger"
                          onClick={() => removeMember(member.id)}
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    <div className="chip-row">
                      <span className="chip played">やった {counts.played}</span>
                      <span className="chip wanted">やりたい {counts.wanted}</span>
                    </div>
                  </article>
                )
              })
            )}
          </section>
        )}

        {activeTab === 'works' && (
          <section className="panel-stack">
            <div className="panel panel-header">
              <div>
                <h2>作品一覧</h2>
                <p>作品ごとに誰がやったか、誰がやりたいかを見られます。</p>
              </div>
            </div>

            {worksWithPeople.map((work) => (
              <article className="panel work-card" key={work.id}>
                <div className="work-head">
                  <div>
                    <h3>{work.title}</h3>
                    <p>
                      {work.playerCountText}・{work.durationMin}分
                    </p>
                  </div>
                  <span className="work-id">{work.id}</span>
                </div>

                <div className="status-grid">
                  <div>
                    <h4>やった</h4>
                    <p>
                      {work.playedBy.length
                        ? work.playedBy.join('、')
                        : 'まだいません'}
                    </p>
                  </div>
                  <div>
                    <h4>やりたい</h4>
                    <p>
                      {work.wantedBy.length
                        ? work.wantedBy.join('、')
                        : 'まだいません'}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}

        {activeTab === 'schedule' && (
          <section className="panel-stack">
            <div className="panel panel-header schedule-header">
              <div>
                <h2>日程調整</h2>
                <p>候補日は共有され、参加者ごとに ○ △ × を登録できます。</p>
              </div>

              <div className="date-add-box">
                <input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                <button className="primary-button" onClick={addDate}>
                  候補日を追加
                </button>
              </div>
            </div>

            {scheduleSummary.length === 0 ? (
              <div className="panel empty-state">
                <h3>候補日がありません</h3>
                <p>まず1件追加してください。</p>
              </div>
            ) : (
              scheduleSummary.map((date) => (
                <article className="panel schedule-card" key={date.id}>
                  <div className="member-head">
                    <div>
                      <h3>{date.label}</h3>
                      <p>参加者編集画面から可否を選択します。</p>
                    </div>
                    <button
                      className="ghost-button danger"
                      onClick={() => removeDate(date.id)}
                    >
                      削除
                    </button>
                  </div>

                  <div className="chip-row">
                    <span className="chip ok">○ {date.ok}</span>
                    <span className="chip maybe">△ {date.maybe}</span>
                    <span className="chip ng">× {date.ng}</span>
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
                <p>作品状態と日程可否は選択式です。</p>
              </div>
              <button
                className="ghost-button"
                onClick={() => setEditorOpen(false)}
              >
                閉じる
              </button>
            </div>

            <section className="editor-section">
              <label className="field-label">名前</label>
              <input
                className="text-input"
                value={draft.name}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="名前を入力"
              />

              <label className="field-label">メモ</label>
              <textarea
                className="text-area"
                value={draft.notes}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="補足があれば入力"
              />
            </section>

            <section className="editor-section">
              <div className="section-head-inline">
                <h3>作品状態</h3>
                <select
                  value={workFilter}
                  onChange={(e) => setWorkFilter(e.target.value)}
                >
                  <option value="all">すべて</option>
                  <option value="played">やった</option>
                  <option value="wanted">やりたい</option>
                  <option value="unknown">未設定</option>
                </select>
              </div>

              <div className="works-editor-list">
                {filteredWorks.map((work) => (
                  <article className="mini-work-card" key={work.id}>
                    <div>
                      <h4>{work.title}</h4>
                      <p>
                        {work.playerCountText}・{work.durationMin}分
                      </p>
                    </div>

                    <div className="segmented-row">
                      {WORK_STATUSES.map((status) => (
                        <button
                          key={status.key}
                          className={
                            draft.workStatuses?.[work.id] === status.key
                              ? 'segment active'
                              : 'segment'
                          }
                          onClick={() => updateWorkStatus(work.id, status.key)}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="editor-section">
              <h3>候補日への参加可否</h3>
              <div className="works-editor-list">
                {dates.length === 0 ? (
                  <p>候補日がまだありません。</p>
                ) : (
                  dates.map((date) => (
                    <article className="mini-work-card" key={date.id}>
                      <div>
                        <h4>{date.label}</h4>
                        <p>○ / △ / × を選択</p>
                      </div>

                      <div className="segmented-row">
                        {DATE_STATUSES.map((status) => (
                          <button
                            key={status.key}
                            className={
                              draft.availability?.[date.id] === status.key
                                ? 'segment active'
                                : 'segment'
                            }
                            onClick={() => updateDateStatus(date.id, status.key)}
                          >
                            {status.label}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <div className="sheet-actions">
              <button
                className="ghost-button"
                onClick={() => setEditorOpen(false)}
              >
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