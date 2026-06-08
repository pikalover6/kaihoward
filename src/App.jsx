import { Route, Routes } from 'react-router-dom'
import './App.css'
import './pages/PersonalCommand.css'
import HomePage from './pages/HomePage.jsx'
import PersonalPage from './pages/PersonalPage.jsx'
import NewsPage from './pages/NewsPage.jsx'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/personal" element={<PersonalPage />} />
      <Route path="/news" element={<NewsPage />} />
      <Route path="/news/archive" element={<NewsPage view="archive" />} />
      <Route path="/news/:date" element={<NewsPage />} />
    </Routes>
  )
}

export default App
