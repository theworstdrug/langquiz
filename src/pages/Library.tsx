import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, type Course, type Lesson, type Term } from '../lib/db';
import { deleteCourse, deleteLesson, newWordStats } from '../lib/actions';
import { useTermMap } from '../lib/hooks';
import { youtubeThumb } from '../lib/youtube';

type Sort = 'recent' | 'opened' | 'easiest' | 'title';

export default function Library({ lang }: { lang: string }) {
  const lessons = useLiveQuery(() => db.lessons.where({ lang }).toArray(), [lang]);
  const courses = useLiveQuery(() => db.courses.where({ lang }).toArray(), [lang]);
  const terms = useTermMap(lang);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('opened');
  const [courseFilter, setCourseFilter] = useState<number | 'all' | 'none'>('all');

  const rows = useMemo(() => {
    if (!lessons || !terms) return [];
    const ql = q.toLowerCase();
    const list = lessons
      .filter((l) => !ql || l.title.toLowerCase().includes(ql) || l.tags.some((t) => t.toLowerCase().includes(ql)))
      .filter((l) => courseFilter === 'all' || (courseFilter === 'none' ? !l.courseId : l.courseId === courseFilter))
      .map((l) => ({ lesson: l, stats: newWordStats(l, terms) }));
    list.sort((a, b) => {
      switch (sort) {
        case 'recent':
          return b.lesson.createdAt - a.lesson.createdAt;
        case 'opened':
          return (b.lesson.lastOpenedAt ?? 0) - (a.lesson.lastOpenedAt ?? 0) || b.lesson.createdAt - a.lesson.createdAt;
        case 'easiest':
          return a.stats.pctNew - b.stats.pctNew;
        case 'title':
          return a.lesson.title.localeCompare(b.lesson.title);
      }
    });
    return list;
  }, [lessons, terms, q, sort, courseFilter]);

  if (!lessons || !courses || !terms) return <p className="muted">Loading…</p>;

  const continueLesson = [...lessons].filter((l) => l.lastOpenedAt && !l.completed).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!)[0];

  return (
    <div>
      <div className="page-head">
        <h1>Library</h1>
        <Link to="/import" className="btn primary">
          + Import lesson
        </Link>
      </div>

      {continueLesson && (
        <Link to={`/lesson/${continueLesson.id}`} className="card continue">
          <span className="muted small">Continue studying</span>
          <strong>{continueLesson.title}</strong>
        </Link>
      )}

      {courses.length > 0 && (
        <section>
          <h2>Courses</h2>
          <div className="grid">
            {courses.map((c) => (
              <CourseCard
                key={c.id}
                course={c}
                lessons={lessons.filter((l) => l.courseId === c.id)}
                terms={terms}
                active={courseFilter === c.id}
                onSelect={() => setCourseFilter(courseFilter === c.id ? 'all' : c.id!)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="toolbar">
          <h2>Lessons</h2>
          <input placeholder="Search lessons or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={String(courseFilter)} onChange={(e) => setCourseFilter(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))}>
            <option value="all">All courses</option>
            <option value="none">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="opened">Recently opened</option>
            <option value="recent">Newest</option>
            <option value="easiest">Fewest new words</option>
            <option value="title">Title</option>
          </select>
        </div>
        {rows.length === 0 ? (
          <div className="card empty">
            No lessons yet. <Link to="/import">Import something to read</Link> — an article, a book (EPUB), subtitles or any
            text.
          </div>
        ) : (
          <div className="grid">
            {rows.map(({ lesson, stats }) => (
              <LessonCard key={lesson.id} lesson={lesson} stats={stats} course={courses.find((c) => c.id === lesson.courseId)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LessonCard({ lesson, stats, course }: { lesson: Lesson; stats: ReturnType<typeof newWordStats>; course?: Course }) {
  return (
    <div className="card lesson-card">
      <Link to={`/lesson/${lesson.id}`} className="lesson-link">
        {lesson.youtubeId && <img className="thumb" src={youtubeThumb(lesson.youtubeId)} alt="" loading="lazy" />}
        <div className="lesson-title">
          {lesson.completed && <span title="Completed">✅ </span>}
          {lesson.title}
        </div>
        {course && <div className="muted small">{course.title}</div>}
        <div className="lesson-meta">
          <span className="pill blue" title="New words">
            {stats.fresh} new
          </span>
          <span className="pill yellow" title="LingQs">
            {stats.lingqs} LingQs
          </span>
          <span className="muted small">{lesson.wordCount} words</span>
          {lesson.youtubeId ? <span title="YouTube video">🎬</span> : (lesson.audio || lesson.mediaUrl) && <span title="Has audio">🎧</span>}
        </div>
        <div className="bar" title={`${stats.pctNew}% new words`}>
          <div style={{ width: `${100 - stats.pctNew}%` }} />
        </div>
      </Link>
      <button
        className="icon danger"
        title="Delete lesson"
        onClick={() => confirm(`Delete "${lesson.title}"?`) && deleteLesson(lesson.id!)}
      >
        ✕
      </button>
    </div>
  );
}

function CourseCard({
  course,
  lessons,
  terms,
  active,
  onSelect,
}: {
  course: Course;
  lessons: Lesson[];
  terms: Map<string, Term>;
  active: boolean;
  onSelect: () => void;
}) {
  const unique = new Set(lessons.flatMap((l) => l.uniqueWords));
  const stats = newWordStats({ uniqueWords: [...unique] }, terms);
  const done = lessons.filter((l) => l.completed).length;
  return (
    <div className={`card course-card ${active ? 'active' : ''}`} onClick={onSelect}>
      <div className="lesson-title">📚 {course.title}</div>
      <div className="muted small">
        {lessons.length} lessons · {done} completed · {stats.pctNew}% new words
      </div>
      <button
        className="icon danger"
        title="Delete course"
        onClick={(e) => {
          e.stopPropagation();
          if (!confirm(`Delete course "${course.title}"?`)) return;
          deleteCourse(course.id!, confirm('Also delete its lessons? (Cancel keeps them as standalone lessons)'));
        }}
      >
        ✕
      </button>
    </div>
  );
}
