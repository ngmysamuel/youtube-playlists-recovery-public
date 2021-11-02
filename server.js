// create an express app
const express = require("express");
const cors = require('cors');
const app = express();
const { default: axios } = require("axios");
const FormData = require('form-data');
const jwt_decode =  require("jwt-decode");
try {
  var config = require('./config');
} catch (error) {
  console.log('eh, config file not avail. Will use env variables.')
}

const { MongoClient } = require("mongodb");
const uri = config ? config.MONGODB_URI : process.env.MONGODB_URI;
const mongo_database_name = config ? config.MONGO_DATABASE_NAME : process.env.MONGO_DATABASE_NAME;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
client.connect()
    .then(() => {console.log('Database connected');})
    .catch((e) => {
        console.error(e);
        // Always hard exit on a database connection error
        process.exit(1);
    });

const my_email = config ? config.MY_EMAIL : process.env.MY_EMAIL;
const sgMail = require('@sendgrid/mail')
sgMail.setApiKey(config ? config.SENDGRID_API_KEY : process.env.SENDGRID_API_KEY)
const sgMailMsg = {
  to: '',
  from: my_email,
  subject: 'You have new missing videos',
  text: '',
  html: '',
}

const port = process.env.PORT || 3000;
const client_id = config ? config.CLIENT_ID : process.env.CLIENT_ID;
const client_secret = config ? config.CLIENT_SECRET : process.env.CLIENT_SECRET;
const redirect_uri = config ? config.REDIRECT_URI_FIRST + port + config.REDIRECT_URI_SECOND : process.env.REDIRECT_URI;
const scope = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.email";
const auth_url = "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=" + client_id + "&redirect_uri=" + redirect_uri + "&scope=" + scope + "&include_granted_scopes=true&access_type=offline"; //&prompt=consent to force get a refresh_token

const current_date_time = new Date().toISOString();


app.use(cors());
// use the express-static middleware
app.use(express.static("public"));
// we are going to use the PUG template engine
app.set('view engine', 'pug');
// we need to parse the body of the POST request to save the preferences
app.use(express.urlencoded());



app.get("/", (req, res) => {
  console.log("/ has been called")
    // res.sendFile('./public/youtube.html', { root: "." })
    res.render('index', {
      authEnabled: true,
      videoEnabled: false,
      viewPlaylistsEnabled: false,
    });
  });

  app.get("/homepage", (req,res) => {
    console.log("/homepage has been called")
    res.render('homepage', {
      authEnabled: true,
      videoEnabled: false,
      viewPlaylistsEnabled: false,
    });
  })

app.get("/privacyPolicy", (req, res) => {
  console.log("/ has been called")
  res.sendFile('./public/privacyPolicy.html', { root: "." })
  });

app.get("/getMissingVideos/:userId", async (req, res) => {
  console.log("/getMissingVideos has been called");
  const database = client.db(mongo_database_name);
  const userId = req.params.userId;
  let collection = database.collection(userId);
  const missingVideoDocument = await collection.findOne({id: 'youtube_playlists_recovery_missing_videos'});
  res.render('index', {
    authEnabled: false,
    videoEnabled: false,
    viewPlaylistsEnabled: true,
    viewMissingVideosEnabled: true,
    missingVideos: missingVideoDocument.playlistVideos,
    userId: userId,
  });
});

app.get("/getPlaylists/:userId",async (req, res) => {
  function refreshToken(data) {
    const form = new FormData();
    form.append('client_id', data.client_id);
    form.append('client_secret', data.client_secret);
    form.append('refresh_token', data.refresh_token);
    form.append('grant_type', 'refresh_token');
    return axios.post('https://oauth2.googleapis.com/token', form, { headers: form.getHeaders() })
  }
  console.log("/getPlaylists has been called")
  const userId = req.params.userId;
  const database = client.db(mongo_database_name)
  let collection = database.collection(userId);
  const tokens = await collection.findOne({user_id: userId});
  const refresh_token = tokens.refresh_token;
  let access_token = tokens.access_token;
  let expires_in = tokens.expires_in;
  let now = new Date();
  if (now > expires_in || access_token === "") {
    try {
      console.log('tokens have expired or access token is empty. Will use refresh token: ', refresh_token);
      const data = {
        'client_id': client_id,
        'client_secret': client_secret,
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token
      }
      const refreshed_tokens = await refreshToken(data);
      expires_in = new Date(now.getTime() + refreshed_tokens.data.expires_in*1000);
      access_token = refreshed_tokens.data.access_token;
      collection.updateOne({user_id: userId}, {$set: {access_token: access_token, expires_in: expires_in}})
      console.log('Successfully auth. expires_in: ', expires_in, ' refresh token: ', refresh_token, ', calling yt api');
    } catch (error) {
      console.log(error.response);
      res.status(500).send("/getPlaylists error in refreshing token: " + error);
      return;
    }
  }
  const url = "https://www.googleapis.com/youtube/v3/playlists?access_token=" + access_token + "&part=snippet&mine=true&maxResults=50";
  const response = await axios.get(url);
  response.data.items.push({'snippet': {'title': 'Liked Videos'}, id: 'LL'})
  res.render('index', {
    authEnabled: false,
    videoEnabled: false,
    viewPlaylistsEnabled: true,
    viewMissingVideosEnabled: true,
    userId: userId,
    playlistItems: response.data.items,
    checkedPlaylists: tokens.preferences ? Object.values(tokens.preferences) : [],
  });
  return;
})

app.post("/savePreferences/:userId", async (req, res) => {
  console.log("/savePreferences has been called")
  const preferences = req.body;
  const userId = req.params.userId;
  console.log(preferences)
  console.log(userId);
  const database = client.db(mongo_database_name);
  let collection = database.collection(userId);
  await collection.updateOne({user_id: userId}, {$set: {preferences: preferences}}, {});
  res.status(200).render('index', {
    authEnabled: false,
    videoEnabled: false,
    viewPlaylistsEnabled: true,
    viewMissingVideosEnabled: true,
    userId: userId,
    message: 'Preferences submitted'
  });
  return;
})

app.get("/auth", async (req, res) => {  
  function getAccessToken(data) {
    const form = new FormData();
    form.append('code', data.code);
    form.append('client_id', data.client_id);
    form.append('client_secret', data.client_secret);
    form.append('redirect_uri', data.redirect_uri);
    form.append('grant_type', data.grant_type);
    console.log("inside of getAccessToken. data: ", data)
    return axios.post('https://oauth2.googleapis.com/token', form, { headers: form.getHeaders() })
  }
  console.log("/auth has been called with query params: ", req.query)
  if (!(req.query.hasOwnProperty('code'))) {
    console.log("I will need to auth at: ", auth_url);
    res.status(202).json({auth_url});
    return;
  } else {
    const code = req.query.code;
    const data = {
      'code': code,
      'client_id': client_id,
      'client_secret': client_secret,
      'redirect_uri': redirect_uri,
      'grant_type': 'authorization_code',
    }
    try {
      const returnData = await getAccessToken(data);
      console.log('have waited for getAccessToken: ', returnData.data)

      const database = client.db(mongo_database_name);

      let now = new Date();
      let expires_in = new Date(now.getTime() + returnData.data.expires_in*1000);
      let id_token = returnData.data.id_token;
      let decoded = jwt_decode(id_token);
      let user_id = decoded.sub;
      let collection = database.collection(user_id)
      const tokens = await collection.findOne({user_id: user_id});
      if (tokens) {
        if (returnData.data.refresh_token) {
          await collection.updateOne({user_id: user_id}, {$set: {access_token: returnData.data.access_token, expires_in: expires_in, refresh_token: returnData.data.refresh_token }}, {})
        } else {
          await collection.updateOne({user_id: user_id}, {$set: {access_token: returnData.data.access_token, expires_in: expires_in}}, {})
        }
      } else {
        await collection.insertOne({
          user_id: user_id,
          email: decoded.email, 
          access_token: returnData.data.access_token,
          refresh_token: returnData.data.refresh_token,
          expires_in: expires_in,
          etag: ""
        })
      }

      console.log('Successfully auth. expires_in: ', expires_in, ' refresh token: ', returnData.data.refresh_token);
      // res.status(200).sendFile('./public/youtube.html', { root: ".", headers: {userId: user_id} })
      res.render('index', {
        authEnabled: false,
        videoEnabled: false,
        viewPlaylistsEnabled: true,
        viewMissingVideosEnabled: true,
        userName: decoded.email,
        userId: user_id,
        message: 'Click "View Playlist" to select which playlists to backup.'
      });
      return;
    } catch (error) {
      res.status(500).send("/auth 1st something went wrong: " + error);
    }
  } 
});

app.get("/video",async (req, res) => {
  function refreshToken(data) {
    console.log("About to refreshToken with data: ", data);
    const form = new FormData();
    form.append('client_id', data.client_id);
    form.append('client_secret', data.client_secret);
    form.append('refresh_token', data.refresh_token);
    form.append('grant_type', 'refresh_token');
    return axios.post('https://oauth2.googleapis.com/token', form, { headers: form.getHeaders() })
  }
  function getItemsInPlaylist(access_token, id, pageToken = "") {
    let url = "https://www.googleapis.com/youtube/v3/playlistItems?access_token=" + access_token + "&part=snippet&playlistId=" + id + "&maxResults=50";
    if (pageToken !== "") {
      url = url + "&pageToken=" + pageToken
    }
    console.log("from getLikedVideos we are calling: ", url);
    return axios.get(url);
  }
  let shouldSendMail = false;
  let htmlMessage = '<table><tr><th>Title</th><th>From Playlist</th><th>Playlist Video ID</th></tr>';
  async function pushIntoMissingVideos(collection, missingVideo) {
    const query = { id: "youtube_playlists_recovery_missing_videos", "playlistVideos.id": missingVideo.id, "playlistVideos.title": missingVideo.title, "playlistVideos.fromPlaylist": missingVideo.playlistName };
    const item = await collection.findOne(query, { projection: { playlistVideos: {$elemMatch: { id: missingVideo.id } } } });
    if (item && item.playlistVideos) {
      if (item.playlistVideos[0].isNew) {
        await collection.updateOne(
          query, 
          { "$set": { "playlistVideos.$.isNew": false, "playlistVideos.$.dateModified": current_date_time } }
        )
      }
      console.log('Video: ' + missingVideo.title + ' - is already inside MissingVideos.')
    } else {
      await collection.updateOne({id: "youtube_playlists_recovery_missing_videos"}, {$push: { playlistVideos: { id: missingVideo.id, title: missingVideo.title, fromPlaylist: missingVideo.playlistName, isNew: true, dateAdded: current_date_time, dateModified: current_date_time } } }, {upsert: true});
      htmlMessage = htmlMessage + '<tr><td>' + missingVideo.title + '</td><td>' + missingVideo.playlistName  + '</td><td>' + missingVideo.id + '</td></tr>'
      console.log('Video: ' + missingVideo.title + ' - will be inserted into MissingVideos.')
      shouldSendMail = true;
    }
  }
  console.log("/video has been called")

  const database = client.db(mongo_database_name);
  const listOfUserId = await database.listCollections().toArray();
  for (let i = 0; i < listOfUserId.length; i++) {
    htmlMessage = '<table><tr><th>Title</th><th>From Playlist</th><th>Playlist Video ID</th></tr>';
    shouldSendMail = false;
    const user_id = listOfUserId[i].name;
    console.log('##################### User: ', user_id, ' #####################');
    let collection = database.collection(user_id);
    const tokens = await collection.findOne({user_id: user_id});
    if (!tokens) {
      continue;
    }
    const refresh_token = tokens.refresh_token;
    let access_token = tokens.access_token;
    let expires_in = tokens.expires_in;
    
    let now = new Date();
    console.log('access_token: ', access_token)
    if (now > expires_in || access_token === "") {
      let toSendMail = true;
      try {
        console.log('tokens have expired or access token is empty');
        const data = {
          'client_id': client_id,
          'client_secret': client_secret,
          'grant_type': 'refresh_token',
          'refresh_token': refresh_token
        }
        const refreshed_tokens = await refreshToken(data);
        expires_in = new Date(now.getTime() + refreshed_tokens.data.expires_in*1000);
        access_token = refreshed_tokens.data.access_token;
        collection.updateOne({user_id: user_id}, {$set: {access_token: access_token, expires_in: expires_in}})
        console.log('Successfully auth. expires_in: ', expires_in, ' refresh token: ', refresh_token, ', calling yt api');
      } catch (error) {
        console.log(error);
        res.status(500).send("/video 1st something went wrong: " + error);
        if (toSendMail) {
          htmlMessage  = 'ALERT! <br />/video 1st something went wrong for user: ' + user_id;
          sgMailMsg.to = my_email;
          sgMailMsg.text = htmlMessage;
          sgMailMsg.html = htmlMessage;
          let emailRes = await sgMail.send(sgMailMsg);
          console.log('Email sent: ', emailRes);
          toSendMail = false;
        }
        return;
      }
    } 

    try {
      const listOfPlaylistNames = Object.keys(tokens.preferences);
      const listOfPlaylistIds = Object.values(tokens.preferences);
      for (let i = 0; i < listOfPlaylistNames.length; i++) {
        const playlistName = listOfPlaylistNames[i];
        const playlistId = listOfPlaylistIds[i];
        console.log('================Playlist: ', playlistName, '================')
        item = await collection.findOne({id: playlistId})
        response = await getItemsInPlaylist(access_token, playlistId);
        if (!item || item.etag !== response.data.etag) { //cannot find playlist in my documents OR there are changes in the playlist
          let cannot_find_item_or_changes_string = item ? 'Prev etag: "' + item.etag + '" will be updated to "' + response.data.etag + '"' : '' + playlistName + ' does not exist'
          console.log(cannot_find_item_or_changes_string)
          await collection.updateOne({id: playlistId}, {$set: {name: playlistName, id: playlistId, etag: response.data.etag, dateModified: current_date_time}}, {upsert: true}) //update DB's etag for the playlist
          let playlistItems = response.data.items;
          while (response.data.nextPageToken) { //get all items in the playlist
            console.log('next page token: ', response.data.nextPageToken)
            response = await getItemsInPlaylist(access_token, playlistId, response.data.nextPageToken);
            playlistItems = playlistItems.concat(response.data.items);
          }
          for (let j = 0; j < playlistItems.length; j++) { //compare each every item
            item = await collection.findOne(
              {"id": playlistId, "playlistVideos.id": playlistItems[j].snippet.resourceId.videoId},
              { projection: { playlistVideos: {$elemMatch: { id: playlistItems[j].snippet.resourceId.videoId } } } });
            if (item && item.playlistVideos) { //we managed to find this item in our database
              item = item.playlistVideos[0];
              if (Object.keys(playlistItems[j].snippet.thumbnails).length <= 0) { // but YouTube has deleted this video
                console.log(j + '. "' + item.title + '" from "' + playlistName + '" is missing.');
                await pushIntoMissingVideos(collection, {title: item.title, playlistName: playlistName, id: playlistItems[j].snippet.resourceId.videoId});
              } else {
                console.log(j + '. "' + item.title + '" from "' + playlistName + '" is nominal');
              }
            } else { // we never had this item inside of database
              await collection.updateOne({id: playlistId}, {$push: { playlistVideos: { id: playlistItems[j].snippet.resourceId.videoId, title: playlistItems[j].snippet.title, dateAdded: current_date_time, dateModified: current_date_time } } });
              console.log(j + '. "' + playlistItems[j].snippet.title + '" has been added to "' + playlistName + '"');
            } //it is important that we do not remove the YT deleted video ourselves as it contains the ID of the original video which we use. 
          }
        } else {
          console.log("No change in: " + playlistName);
        }
      }

      console.log("We have finished looking at Videos")
      if (shouldSendMail) {
        htmlMessage  = htmlMessage + '</table>';
        sgMailMsg.to = tokens.email;
        sgMailMsg.text = htmlMessage;
        sgMailMsg.html = htmlMessage;
        let emailRes = await sgMail.send(sgMailMsg);
        console.log('Email sent');
      }

      res.json(JSON.stringify({}));
      console.log("==========Done===========")
    } catch (error) {
      console.log(error);
      res.status(500).send("/video 2nd something went wrong: " + error);
      htmlMessage  = 'ALERT! <br />/video 2nd something went wrong with user: ' + user_id;
      sgMailMsg.to = my_email;
      sgMailMsg.text = htmlMessage;
      sgMailMsg.html = htmlMessage;
      let emailRes = await sgMail.send(sgMailMsg);
      console.log('Email sent: ', emailRes);
    } 
  }

})


// start the server listening for requests
app.listen(process.env.PORT || 3000, 
	() => console.log("Server is running..."));