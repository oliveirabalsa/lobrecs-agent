const cards = document.querySelectorAll('.feature-grid article, .steps li, .signal-strip article')

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

const pipeline = document.querySelector('.pipeline')

setInterval(() => {
  pipeline?.classList.toggle('is-hot')
}, 2600)
