import {useEffect} from 'react';
import { BrowserRouter as Router, Routes, Route} from 'react-router-dom';

import './App.css';
import Main from './components/main';
import Home from './components/home';

import Nav from './components/nav';
import PaymentForm from './components/payment';
// import Footer from './components/footer';

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
        <Route path='/' element={<Home />} />
        <Route path='/processing' component={Main} />
        <Route path='reciept' component={Main} />
        <Route path='/payment' exact element={<PaymentForm />} />
      </Routes>
      
    </Router>
  );
}

export default App;
