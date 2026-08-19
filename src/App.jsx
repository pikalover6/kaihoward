import './App.css'

const projects = [
  {
    name: 'Terrainist',
    domain: 'terrainist.com',
    href: 'https://terrainist.com/',
    accent: '#49c879',
  },
  {
    name: 'GPT-2 Whisperer',
    domain: 'pikalover6.github.io',
    href: 'https://pikalover6.github.io/gpt2whisperer/',
    accent: '#4aa8ff',
  },
  {
    name: 'Claude Subagents Effort',
    domain: 'github.com',
    href: 'https://github.com/pikalover6/claude-subagents-effort',
    accent: '#9b75ff',
  },
  {
    name: 'totally-not-an-llm',
    domain: 'huggingface.co',
    href: 'https://huggingface.co/totally-not-an-llm',
    accent: '#ffbf3f',
  },
]

function App() {
  return (
    <main className="page">
      <div className="layout">
        <header className="title-bar">
          <h1>kaihoward.com</h1>
          <a
            className="mail-link"
            href="mailto:kaihoward106@gmail.com"
            aria-label="Email Kai Howard"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 6.75h15v10.5h-15z" />
              <path d="m5 7.25 7 5.5 7-5.5" />
            </svg>
          </a>
        </header>

        <nav className="project-grid" aria-label="Projects">
          {projects.map(({ name, domain, href, accent }, index) => (
            <a
              key={href}
              className="project-card"
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{ '--accent': accent }}
            >
              <span className="project-number">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="project-arrow" aria-hidden="true">↗</span>
              <span className="project-name">{name}</span>
              <span className="project-domain">{domain}</span>
            </a>
          ))}
        </nav>
      </div>
    </main>
  )
}

export default App
