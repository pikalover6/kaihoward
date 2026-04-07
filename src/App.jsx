import './App.css'

const navLinks = [
  { label: 'GitHub',      href: 'https://github.com/pikalover6' },
  { label: 'Huggingface', href: 'https://huggingface.co/totally-not-an-llm' },
  { label: 'Instagram',   href: 'https://www.instagram.com/kaihoward824/' },
  { label: 'Email',       href: 'mailto:kaihoward106@gmail.com' },
]

function App() {
  return (
    <div className="page">
      <div className="layout">

        <nav className="navbar">
          <span className="nav-brand">kaihoward.com</span>
          <div className="nav-right">
            {navLinks.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="nav-link"
                target={href.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
              >
                {label}
              </a>
            ))}
          </div>
        </nav>

        <div className="card">
          <div className="card-inner">
            <p className="card-bio">
              <span className="indent" />Hi, I&apos;m <strong>Kai Howard</strong> — a developer who loves
              building clean, thoughtful digital experiences. I care deeply about the intersection
              of design and technology, and I enjoy crafting interfaces that feel as good as they look.
              When I&apos;m not writing code, you&apos;ll find me exploring machine learning, tinkering
              with side projects, or chasing the perfect cup of coffee.
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
