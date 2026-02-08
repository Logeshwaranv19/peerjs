// Get or generate the room ID from the URL query parameter.
const urlParams = new URLSearchParams(window.location.search);
let room = urlParams.get("room");
if (!room) {
  room = Math.random().toString(36).substr(2, 6);
  const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + room;
  window.history.pushState({ path: newUrl }, '', newUrl);
}
document.getElementById("room-id").textContent = room;
// Initialize variables
let peer;
//
let conn;
let localStream = null;
let currentCall = null;
let isScreenSharing = false;

// Polyfill for getUserMedia and getDisplayMedia for broader browser support
(function initMediaDevices() {
  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
  }
  // Polyfill getUserMedia if needed
  // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
  if (!navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = function(constraints) {
      const getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
      if (!getUserMedia) {
        return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
      }
      return new Promise(function(resolve, reject) {
        getUserMedia.call(navigator, constraints, resolve, reject);
      });
    };
  }
  
  // Also polyfill getDisplayMedia if needed
  if (!navigator.mediaDevices.getDisplayMedia) {
    navigator.mediaDevices.getDisplayMedia = function(constraints) {
      return Promise.reject(new Error('Screen sharing not supported in this browser'));
    };
  }
})();

// Check if we're on HTTPS or localhost
function isSecureContext() {
  return window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

// Encrypt message using AES
async function encryptMessage(message) {
  return CryptoJS.AES.encrypt(message, room).toString();
}

// Decrypt message using AES
async function decryptMessage(data) {
  const bytes = CryptoJS.AES.decrypt(data, room);
  return bytes.toString(CryptoJS.enc.Utf8);
}

async function startScreenShare() {
  try {
    if (!isSecureContext()) {
      throw new Error('Screen sharing requires HTTPS or localhost');
    }
    
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen sharing not supported in this browser');
    }
    
    localStream = await navigator.mediaDevices.getDisplayMedia({ 
      video: true, 
      audio: true 
    });
    
    document.getElementById("localVideo").srcObject = localStream;
    document.getElementById("localVideo").style.display = "block";
    
    if (conn && conn.open) {
      const remotePeerId = conn.peer;
      const call = peer.call(remotePeerId, localStream, { 
        metadata: { isScreenShare: true } 
      });
      setupCall(call);
      isScreenSharing = true;
      document.getElementById("shareScreenButton").style.display = "none";
      document.getElementById("endScreenShareButton").style.display = "block";
      adjustShareLayout(true);
      logMessage("Screen sharing started", "system");
    } else {
      logMessage("Remote connection not available for screen sharing.", "system");
    }
  } catch (err) {
    console.error("Error starting screen share:", err);
    logMessage("Error starting screen share: " + err.message, "system");
  }
}

function endScreenShare() {
  if (isScreenSharing) {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (currentCall) {
      currentCall.close();
      currentCall = null;
    }
    if (conn && conn.open) {
      conn.send({ type: "call-ended" });
    }
    document.getElementById("localVideo").srcObject = null;
    document.getElementById("localVideo").style.display = "none";
    document.getElementById("shareScreenButton").style.display = "block";
    document.getElementById("endScreenShareButton").style.display = "none";
    isScreenSharing = false;
    adjustShareLayout(false);
    logMessage("Screen sharing ended.", "system");
  }
}

function logMessage(msg, type = "system") {
  const p = document.createElement("p");
  p.textContent = msg;
  if (type === "sent") {
    p.classList.add("sent");
  } else if (type === "received") {
    p.classList.add("received");
  } else {
    p.classList.add("system");
  }
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    p.style.fontSize = type === "system" ? "35px" : "50px";
  }
  const chatDiv = document.getElementById("chat");
  chatDiv.appendChild(p);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

function appendChatElement(element, type) {
  const container = document.createElement("div");
  if (type === "sent") {
    container.classList.add("sent");
  } else if (type === "received") {
    container.classList.add("received");
  } else {
    container.classList.add("system");
  }
  container.appendChild(element);
  const chatDiv = document.getElementById("chat");
  chatDiv.appendChild(container);
  chatDiv.scrollTop = chatDiv.scrollHeight;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    container.style.fontSize = type === "system" ? "35px" : "50px";
  }
}

function initHost() {
  const hostId = room + '-host';
  
  // Enhanced PeerJS configuration
  peer = new Peer(hostId, {
    debug: 3,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    }
  });
  
  peer.on('open', function(id) {
    console.log('Host peer open: ' + id);
    logMessage("Host started. Waiting for peer to join... Room: " + room, "system");
    logMessage("Share this room ID with your peer: " + room, "system");
    
    peer.on('connection', function(connection) {
      console.log('Host received connection');
      conn = connection;
      setupConnection();
    });
    
    peer.on('call', function(call) {
      console.log('Host received call');
      handleIncomingCallAsHost(call);
    });
  });

  peer.on('error', function(err) {
    console.log('Peer error:', err);
    if (err.type === 'unavailable-id') {
      logMessage("Host already exists, joining as guest...", "system");
      setTimeout(initGuest, 1000);
    } else {
      logMessage("Peer error: " + err, "system");
    }
  });
}

function initGuest() {
  const guestId = room + '-guest';
  
  peer = new Peer(guestId, {
    debug: 3,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    }
  });
  
  peer.on('open', function(id) {
    console.log('Guest peer open: ' + id);
    logMessage("Joining as guest...", "system");
    
    // Connect to host
    conn = peer.connect(room + '-host', {
      reliable: true
    });
    
    setupConnection();
    
    peer.on('call', function(call) {
      console.log('Guest received call');
      handleIncomingCallAsGuest(call);
    });
  });

  peer.on('error', function(err) {
    console.log('Guest peer error:', err);
    logMessage("Connection error: " + err, "system");
  });
}

function handleIncomingCallAsHost(call) {
  console.log('Host handling incoming call');
  
  try {
    if (call.metadata && call.metadata.isScreenShare) {
      call.answer();
      setupCall(call);
      adjustShareLayout(true);
      logMessage("Receiving screen share...", "system");
    } else {
      call.answer();
      setupCall(call);
      adjustVideoLayout(true);
      logMessage("Incoming video call answered", "system");
    }
  } catch (error) {
    console.error("Error handling incoming call:", error);
    logMessage("Error answering call: " + error.message, "system");
  }
}

function handleIncomingCallAsGuest(call) {
  console.log('Guest handling incoming call');
  
  try {
    if (call.metadata && call.metadata.isScreenShare) {
      call.answer();
      setupCall(call);
      adjustShareLayout(true);
      logMessage("Receiving screen share...", "system");
    } else {
      call.answer();
      setupCall(call);
      adjustVideoLayout(true);
      logMessage("Incoming video call answered", "system");
    }
  } catch (error) {
    console.error("Error handling incoming call:", error);
    logMessage("Error answering call: " + error.message, "system");
  }
}

function initPeer() {
  // Show security warning if not on HTTPS/localhost
  if (!isSecureContext()) {
    logMessage("⚠️ Warning: Video calls may not work on HTTP. Use HTTPS or localhost for full functionality.", "system");
  }
  
  initHost();
}

function setupConnection() {
  conn.on('open', function() {
    console.log('Connection established');
    logMessage("✅ Connected to peer! You can now start video calls.", "system");
  });
  
  conn.on('data', async function(data) {
    console.log('Received data:', data);
    
    if (data.type === "call-ended") {
      logMessage("The other peer ended the video call.", "system");
      if (currentCall) {
        currentCall.close();
        currentCall = null;
      }
      document.getElementById("remoteVideo").srcObject = null;
      document.getElementById("remoteVideo").style.display = "none";
      adjustVideoLayout(false);
      adjustShareLayout(false);
      return;
    }
    
    if (typeof data === "object" && data.file) {
      if (data.fileType && data.fileType.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = data.file;
        img.alt = data.fileName;
        img.style.maxWidth = "200px";
        img.style.maxHeight = "200px";
        appendChatElement(img, "received");
      } else {
        const container = document.createElement("div");
        const icon = document.createElement("span");
        icon.innerHTML = "💾";
        icon.style.marginRight = "10px";

        const link = document.createElement("a");
        link.href = data.file;
        link.download = data.fileName;
        link.textContent = data.fileName;
        link.style.fontWeight = "bold";

        container.appendChild(icon);
        container.appendChild(link);
        appendChatElement(container, "received");
      }
      return;
    }
    
    try {
      const decryptedMessage = await decryptMessage(data);
      logMessage(decryptedMessage, "received");
    } catch (error) {
      // If decryption fails, treat as plain text
      if (typeof data === 'string') {
        logMessage(data, "received");
      }
    }
  });
  
  conn.on('error', function(err) {
    console.error("Connection error:", err);
    logMessage("Connection error: " + err, "system");
  });
  
  conn.on('close', function() {
    logMessage("Peer has disconnected.", "system");
  });
}

async function sendMessage() {
  const messageInput = document.getElementById("messageInput");
  const message = messageInput.value;
  
  if (message.trim() === "") return;
  
  if (conn && conn.open) {
    try {
      const encrypted = await encryptMessage(message);
      conn.send(encrypted);
      logMessage(message, "sent");
      messageInput.value = "";
    } catch (error) {
      console.error("Encryption error:", error);
      // Send plain text if encryption fails
      conn.send(message);
      logMessage(message, "sent");
      messageInput.value = "";
    }
  } else {
    logMessage("Connection not open yet.", "system");
  }
}

function sendFile() {
  const fileInput = document.getElementById("fileInput");
  if (fileInput.files.length === 0) return;
  
  const file = fileInput.files[0];
  const reader = new FileReader();
  
  reader.onload = function(e) {
    const fileData = e.target.result;
    const payload = {
      file: fileData,
      fileName: file.name,
      fileType: file.type
    };
    
    if (conn && conn.open) {
      conn.send(payload);
      
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = fileData;
        img.alt = file.name;
        img.style.maxWidth = "200px";
        img.style.maxHeight = "200px";
        appendChatElement(img, "sent");
      } else {
        const container = document.createElement("div");
        const icon = document.createElement("span");
        icon.innerHTML = "💾";
        icon.style.marginRight = "10px";

        const link = document.createElement("a");
        link.href = fileData;
        link.download = file.name;
        link.textContent = file.name;
        link.style.fontWeight = "bold";

        container.appendChild(icon);
        container.appendChild(link);
        appendChatElement(container, "sent");
      }
    } else {
      logMessage("Connection not open yet.", "system");
    }
    
    fileInput.value = "";
  };
  
  reader.readAsDataURL(file);
}

async function startVideoCall() {
  try {
    console.log("Starting video call...");
    
    // Check security context
    if (!isSecureContext()) {
      throw new Error('Video calls require HTTPS or localhost. Current URL: ' + window.location.href);
    }
    
    // Check if mediaDevices is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access not supported in this browser');
    }

    logMessage("Requesting camera and microphone access...", "system");
    
    // Get user media with simpler constraints
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    
    console.log("Got local stream:", localStream);
    
    // Show local video
    const localVideo = document.getElementById("localVideo");
    localVideo.srcObject = localStream;
    localVideo.style.display = "block";
    
    if (conn && conn.open) {
      const remotePeerId = conn.peer;
      console.log("Calling remote peer:", remotePeerId);
      
      const call = peer.call(remotePeerId, localStream);
      setupCall(call);
      
      adjustVideoLayout(true);
      document.getElementById("endCallButton").style.display = "block";
      document.getElementById("startCallButton").style.display = "none";
      
      logMessage("Video call started. Waiting for peer to answer...", "system");
    } else {
      logMessage("No connection to remote peer. Make sure both peers are connected.", "system");
    }
  } catch (err) {
    console.error("Error starting video call:", err);
    
    if (err.name === 'NotAllowedError') {
      logMessage("❌ Camera/microphone permission denied. Please allow access to your camera and microphone in browser settings.", "system");
    } else if (err.name === 'NotFoundError') {
      logMessage("❌ No camera/microphone found on this device.", "system");
    } else if (err.name === 'NotSupportedError') {
      logMessage("❌ Video calling not supported in this browser.", "system");
    } else if (err.name === 'NotReadableError') {
      logMessage("❌ Camera/microphone is already in use by another application.", "system");
    } else if (err.message.includes('HTTPS')) {
      logMessage("❌ " + err.message, "system");
      logMessage("💡 Solution: Use 'http://localhost:9091' instead of IP address, or set up HTTPS", "system");
    } else {
      logMessage("❌ Error starting video call: " + err.message, "system");
    }
  }
}

function endVideoCall() {
  console.log("Ending video call");
  
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  
  if (conn && conn.open) {
    conn.send({ type: "call-ended" });
  }
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  document.getElementById("localVideo").srcObject = null;
  document.getElementById("localVideo").style.display = "none";
  document.getElementById("remoteVideo").srcObject = null;
  document.getElementById("remoteVideo").style.display = "none";
  
  adjustVideoLayout(false);
  document.getElementById("endCallButton").style.display = "none";
  document.getElementById("startCallButton").style.display = "block";
  
  logMessage("Video call ended.", "system");
}

function setupCall(call) {
  currentCall = call;
  console.log("Setting up call");
  
  call.on('stream', function(remoteStream) {
    console.log("Received remote stream");
    document.getElementById("remoteVideo").srcObject = remoteStream;
    document.getElementById("remoteVideo").style.display = "block";
    logMessage("✅ Video call connected! You can now see and hear each other.", "system");
  });
  
  call.on('close', function() {
    console.log("Call closed");
    logMessage("Video call ended.", "system");
    document.getElementById("remoteVideo").srcObject = null;
    document.getElementById("remoteVideo").style.display = "none";
    currentCall = null;
  });
  
  call.on('error', function(err) {
    console.error("Call error:", err);
    logMessage("Call error: " + err, "system");
  });
}

function disconnect() {
  console.log("Disconnecting...");
  
  if (conn) {
    conn.close();
    conn = null;
  }
  
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (peer && !peer.destroyed) {
    peer.destroy();
  }
  
  logMessage("Disconnected from room.", "system");
}

function adjustVideoLayout(isVideoCallActive) {
  const remoteVideo = document.getElementById("remoteVideo");
  const localVideo = document.getElementById("localVideo");

  if (isVideoCallActive) {
    remoteVideo.style.width = "70%";
    remoteVideo.style.height = "400px";
    remoteVideo.style.objectFit = "cover";
    remoteVideo.style.display = "block";

    localVideo.style.width = "200px";
    localVideo.style.height = "150px";
    localVideo.style.objectFit = "cover";
    localVideo.style.display = "block";
    localVideo.style.position = "absolute";
    localVideo.style.bottom = "20px";
    localVideo.style.right = "20px";
    localVideo.style.border = "2px solid #40a798";
    localVideo.style.borderRadius = "10px";
  } else {
    remoteVideo.style.width = "0%";
    remoteVideo.style.height = "0%";
    remoteVideo.style.display = "none";

    localVideo.style.width = "0%";
    localVideo.style.height = "0%";
    localVideo.style.display = "none";
    localVideo.style.position = "static";
  }
}

function adjustShareLayout(isScreenShareActive) {
  const remoteVideo = document.getElementById("remoteVideo");

  if (isScreenShareActive) {
    remoteVideo.style.width = "90%";
    remoteVideo.style.height = "500px";
    remoteVideo.style.objectFit = "contain";
    remoteVideo.style.display = "block";
  } else {
    remoteVideo.style.width = "0%";
    remoteVideo.style.height = "0%";
    remoteVideo.style.display = "none";
  }
}

function hideScreenShareButtonIfMobile() {
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    document.getElementById("shareScreenButton").style.display = "none";
    document.getElementById("endScreenShareButton").style.display = "none";
  }
}

// Event listeners
document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("sendButton").addEventListener("click", sendMessage);
  document.getElementById("messageInput").addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      sendMessage();
    }
  });
  document.getElementById("fileButton").addEventListener("click", function() {
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", sendFile);
  document.getElementById("startCallButton").addEventListener("click", startVideoCall);
  document.getElementById("endCallButton").addEventListener("click", endVideoCall);
  document.getElementById("disconnectButton").addEventListener("click", disconnect);
  document.getElementById("shareScreenButton").addEventListener("click", startScreenShare);
  document.getElementById("endScreenShareButton").addEventListener("click", endScreenShare);
  
  hideScreenShareButtonIfMobile();
  
  // Initialize with a small delay to ensure DOM is ready
  setTimeout(initPeer, 500);
});
