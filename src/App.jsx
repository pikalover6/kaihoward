import './App.css'

function App() {
  return (
    <>
      <header className="site-header">
        <nav>
          <span className="nav-name">Kai Howard</span>
          <ul>
            <li><a href="#about">About</a></li>
            <li><a href="#work">Work</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>
      </header>

      <main>
        <section id="hero">
          <div className="hero-content">
            <p className="hero-eyebrow">Hello, I&apos;m</p>
            <h1>Kai Howard</h1>
            <p className="hero-tagline">Developer &amp; Creative</p>
            <div className="hero-actions">
              <a href="#work" className="btn btn-primary">See My Work</a>
              <a href="#contact" className="btn btn-outline">Get in Touch</a>
            </div>
          </div>
        </section>

        <section id="about">
          <h2>About Me</h2>
          <p>
            I&apos;m a developer passionate about building clean, thoughtful digital
            experiences. I enjoy turning complex problems into simple, elegant
            solutions.
          </p>
        </section>

        <section id="work">
          <h2>Work</h2>
          <div className="work-grid">
            <div className="work-card">
              <h3>Project One</h3>
              <p>A brief description of this project and what makes it interesting.</p>
              <a href="#" className="work-link">View &rarr;</a>
            </div>
            <div className="work-card">
              <h3>Project Two</h3>
              <p>A brief description of this project and what makes it interesting.</p>
              <a href="#" className="work-link">View &rarr;</a>
            </div>
            <div className="work-card">
              <h3>Project Three</h3>
              <p>A brief description of this project and what makes it interesting.</p>
              <a href="#" className="work-link">View &rarr;</a>
            </div>
          </div>
        </section>

        <section id="contact">
          <h2>Get in Touch</h2>
          <p>Have a project in mind or just want to say hi?</p>
          <a href="mailto:kai@example.com" className="btn btn-primary">Email Me</a>
          <div className="social-links">
            <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://linkedin.com" target="_blank" rel="noreferrer">LinkedIn</a>
          </div>
        </section>
      </main>

      <footer>
        <p>&copy; {new Date().getFullYear()} Kai Howard</p>
      </footer>
    </>
  )
}

export default App
