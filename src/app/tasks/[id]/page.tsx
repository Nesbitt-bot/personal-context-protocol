'use client';

import { SiteNav } from '@/components/site-nav';
import { TaskDetailView } from '@/components/tasks/detail/task-detail-view';

/** Standalone task detail page (the board also renders it in a side panel). */
export default function TaskDetailPage({ params }: { params: { id: string } }) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <TaskDetailView id={params.id} />
      </section>
    </main>
  );
}
