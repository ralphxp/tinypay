import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import { initializeApp } from "firebase/app";
import { getDatabase, set, ref, get, child } from "firebase/database";
const axios = require('axios');


function ProcessTx ()
{
  const SEC_KEY = "FLWSECK_TEST-f3ed6a94918305960db00d15a34052ce-X";

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tx_ref, setTx_ref] = useState('');
  const [tx_id, setTx_id] = useState('');
  const [status, setStatus] = useState('');
  const [msg, setMsg] = useState(true);
  const [ok, setOk] = useState(['successful', 'done', 'ok', 'verified', 'completed']);

  useEffect(()=>{
    const queryString = window.location.search;
    const params = new URLSearchParams(queryString);

    if(typeof params.get('status') === 'string')
    {
      setStatus(params.get('status'));

      if(ok.includes(status))
      {
        setMsg(true);

        setTx_ref(params.get('tx_ref'));
        setTx_id(params.get('transaction_id'));
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SEC_KEY}`
        }

        const url = `https://api.flutterwave.com/v3/transactions/${tx_id}/verify`

        fetch(url, headers )
          .then(response => response.json())
          .then(data => console.log(data));
        
      }
    }


  });

	var firebaseConfig = {
    apiKey: "AIzaSyCEe_F84tWMld0krlGB0qBGPwlO0MpOIbc",
    authDomain: "tinypay-d15ab.firebaseapp.com",
    projectId: "tinypay-d15ab",
    storageBucket: "tinypay-d15ab.appspot.com",
    messagingSenderId: "342920559667",
    appId: "1:342920559667:web:60e451e6dbb0d2d041b746",
    measurementId: "G-0T11V4MPTR",
    databaseURL: 'https://tinypay-d15ab-default-rtdb.asia-southeast1.firebasedatabase.app/'
  };

  // Initialize Firebase
  var app = initializeApp(firebaseConfig);
  var db = getDatabase(app);

  const saveData = (id, tx_ref, tx_id, email, name, phone)=>{
    set(ref(db, 'users/' + 1), {
      username: "Rapha panchi",
      email: "foo@baa.com",
      profile_picture : "ok"
    }).then(e=>{
      console.log("successful")
    }).catch(err=>{console.log(err)});
  }
  const readData = (db)=>{
    const dbRef = ref(db);
    get(child(dbRef, `users/1`)).then((snapshot) => {
      if (snapshot.exists()) {
        console.log(snapshot.val());
      } else {
        console.log("No data available");
      }
    }).catch((error) => {
      console.error(error);
    });
  }
	return (
    <section id='hero' className='d-flex align-items-center justify-content-center contact section-bg'>
      <div className="col-lg-6 mt-4 mt-md-0">
        <h1>{msg?<>Transaction Was successful <Link to='/' className="btn-get-started">Back</Link></>:<></>}</h1>
      </div>
    </section>
  );
}


export default ProcessTx;