import {useEffect} from 'react';
import { BrowserRouter as Router, Routes, Route} from 'react-router-dom';

import './App.css';
import Main from './components/main';
import Home from './components/home';

import Nav from './components/nav';
import PaymentForm from './components/payment';
import ProcessTx from './components/backend/process';

function App() {
  

  useEffect(()=>{
    console.log(`
       --------WELCOME----BACK--------
    
    `);
  });

  return (
    <Router>
      <Nav />
      <Routes>
        <Route path='//*' element={<Home />} />
        <Route path='/payment' element={<PaymentForm />} />
        <Route path='/processing' element={<ProcessTx />} />
        <Route path='/About' element={<Main />} />
      </Routes>
      
    </Router>
  );
}

export default App;
