import { Route, Routes } from 'react-router-dom'
import './App.css'
import './pages/PersonalCommand.css'
import HomePage from './pages/HomePage.jsx'
import PersonalPage from './pages/PersonalPage.jsx'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/personal" element={<PersonalPage />} />
    </Routes>
  )
}

export default App
