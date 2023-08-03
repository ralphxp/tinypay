import {useEffect} from 'react';
import { Routes, Route} from 'react-router-dom';

import './App.css';
import Main from './components/main';
import Home from './components/home';

import Nav from './components/nav';
import PaymentForm from './components/payment';
import ProcessTx from './components/backend/process';

function App() {
  

  

  return (
    <>
      <Nav />
      <Routes>
        <Route path='//*' exact element={<Home />} />
        <Route path='/payment' exact element={<PaymentForm />} />
        <Route path='/processing' exact element={<ProcessTx />} />
        <Route path='/About' exact element={<Main />} />
      </Routes>
      
    </>
  );
}

export default App;
