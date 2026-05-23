import type { PlanModeQuestionAnswerView } from '../lib/planModeQuestionAnswer'

interface QuestionAnswerCardProps {
  view: PlanModeQuestionAnswerView
}

export function QuestionAnswerCard({ view }: QuestionAnswerCardProps) {
  return (
    <article className="shadow-elevated ml-auto w-full max-w-[85%] overflow-hidden rounded-card border border-accent-primary/30 bg-card sm:max-w-[70%]">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-accent-primary/30 bg-accent-primary/15 text-accent-primary">
          {iconQuestions}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary">Question answered</div>
          <div className="text-[11px] text-muted">
            {view.questions.length} {view.questions.length === 1 ? 'answer' : 'answers'}
          </div>
        </div>
        <div className="ml-auto rounded-pill border border-accent-primary/25 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-primary">
          Plan mode
        </div>
      </header>

      <div className="flex flex-col divide-y divide-hairline">
        {view.questions.map((item, index) => (
          <div key={index} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-secondary" />
              <span className="text-[13px] font-medium text-primary">
                {item.question}
              </span>
            </div>
            <div className="flex items-start gap-2 pl-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary" />
              <span className="text-[13px] leading-6 text-secondary">
                {item.answer}
              </span>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

const iconQuestions = (
  <svg
    viewBox="0 0 16 16"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="7" r="5.5" />
    <path d="M5.5 7.5a1.5 1.5 0 0 1 2.9 0" />
    <circle cx="8" cy="12" r="0.8" />
  </svg>
)