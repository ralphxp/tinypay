import {useState, useEffect} from 'react';
import { BrowserRouter as Router} from 'react-router-dom';
import './App.css';
import Main from './components/main';

import Nav from './components/nav';
import Footer from './components/footer';
import Hero from './components/hero';

function App() {

  const [user, setUser] = useState({});

  useEffect(()=>{

  });

  return (
    <Router>
      <Nav />
      <Hero />
      <Main />
      <Footer />
    </Router>
  );
}

export default App;
