import {useEffect} from 'react';
import { initializeApp } from "firebase/app";
import { getDatabase, set, ref, get, child } from "firebase/database";


function ProcessTx ()
{
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
	return <>Done</>;
}


export default ProcessTx;