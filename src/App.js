import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import Home from './components/home';



function App() {
  return (
    <div className="App">
      <Router>
        {/* <Routes> */}
          <Home />
        {/* </Routes> */}
      </Router>
    </div>
  );
}

export default App;
