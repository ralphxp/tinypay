import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import { initializeApp } from "firebase/app";
import { getDatabase, set, ref, get, child } from "firebase/database";

const axios = require('axios');


function ProcessTx ()
{
  // const SEC_KEY = "FLWSECK_TEST-f3ed6a94918305960db00d15a34052ce-X";

  // const [name, setName] = useState('');
  const [email, setEmail] = useState('***@gmail.com');
  // const [phone, setPhone] = useState('');
  // const [tx_ref, setTx_ref] = useState('');
  // const [tx_id, setTx_id] = useState('');
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

        // setTx_ref(params.get('tx_ref'));
        // setTx_id(params.get('transaction_id'));
        
        // const xhr = new XMLHttpRequest();
        // xhr.open('GET', 'https://api.flutterwave.com/v3/transactions'+tx_id+'/verify');
        // xhr.setRequestHeader('Authorization', SEC_KEY);
        // xhr.setRequestHeader('Content-Type', 'application/json');
        // xhr.onreadystatechange = ()=>{
        //   if(xhr.readyState == 4)
        //   {
        //     console.log(xhr.response)
        //   }
        // };
        // xhr.send(null);

        // axios('https://petpaths.000webhostapp.com/auth/?validate=true&tx_id='+tx_id,
        //   headers: { 
        //     'Access-Control-Allow-Origin' : '*',
        //     'Access-Control-Allow-Methods':'GET,PUT,POST,DELETE,PATCH,OPTIONS',
        //   }
        // )
        // .then(resp=>{
        //   console.log(resp);
        // })
        // .catch(err=>{
        //   console.log(err);
        // });

        
        
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
        {msg?<><h1>Transaction Was successful </h1><p>A payment Reciept has been send to your email ({email}).<br /><b>Thank you.</b></p></>:<></>}
        <Link to='/' className="btn-get-started col-4">Got it</Link>
      </div>
      
    </section>
  );
}


export default ProcessTx;