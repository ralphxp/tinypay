import { BrowserRouter as Router} from 'react-router-dom';
import './App.css';
import Home from './components/home';

import Nav from './components/nav';
import Footer from './components/footer';

function App() {
  return (
    <Router>
      <Nav />

      <Footer />
    </Router>
  );
}

export default App;
