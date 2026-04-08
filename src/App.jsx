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
              <span className="indent" />
              I'm an 18 year old HS senior interested in AI and law. View my links and contact above.
              View the source for this website{" "}
              <a href="https://github.com/pikalover6/kaihoward" target="_blank" rel="noopener noreferrer">
                here
              </a>.
              More content coming soon.
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
