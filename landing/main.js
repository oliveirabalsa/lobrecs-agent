const cards = document.querySelectorAll(
  '.feature-grid article, .detail-grid article, .steps li, .signal-strip article, .repo-card',
)

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    }
  },
  { threshold: 0.18 },
)

for (const card of cards) {
  observer.observe(card)
}
