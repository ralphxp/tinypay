import {useEffect} from 'react';
import { Routes, Route} from 'react-router-dom';

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
    <>
      <Nav />
      <Routes>
        <Route path='//*' element={<Home />} />
        <Route path='/payment' element={<PaymentForm />} />
        <Route path='/processing' element={<ProcessTx />} />
        <Route path='/About' element={<Main />} />
      </Routes>
      
    </>
  );
}

export default App;
