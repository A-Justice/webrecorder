const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();

const videosDirectory = path.join(__dirname, "allVideos");

// Mount the videos directory as static content
app.use("/allVideos", express.static(videosDirectory));

app.get("/", async (req, res) => {
  const videoUrl = req.query.url;
  const loginUrl = req.query.loginUrl;
  const emailInputSelector = req.query.emailInputSelector;
  const passwordInputSelector = req.query.passwordInputSelector;
  const loginButtonSelector = req.query.loginButtonSelector;
  const recordedElementSelector = req.query.recordedElementSelector;
  const email = req.query.email;
  const password = req.query.password;
  const ignoreLogin = req.query.needsLogin == "true"?true:false;

  if (!videoUrl) {
    return res.status(400).send("Missing required parameter: url");
  } else if (!loginUrl && !ignoreLogin) {
    return res.status(400).send("Missing required parameter: loginUrl");
  } else if (!emailInputSelector && !ignoreLogin) {
    return res.status(400).send("Missing required parameter: emailInputSelector");
  } else if (!passwordInputSelector && !ignoreLogin) {
    return res.status(400).send("Missing required parameter: passwordInputSelector");
  } else if (!loginButtonSelector && !ignoreLogin) {
    return res.status(400).send("Missing required parameter: loginButtonSelector");
  } else if (!recordedElementSelector) {
    return res.status(400).send("Missing required parameter: recordedElementSelector");
  } else if (!email && !ignoreLogin) {
    return res.status(400).send("Missing required parameter: email");
  } else if (!password && !ignoreLogin) {
    return res.status(400).send("Missing required parameter: password");
  }

  const videoSeconds = parseInt(req.query.seconds) || 10;


  try {
    const videoMiliseconds = videoSeconds * 1000;
    const frameRate = 25;
    const loopControl = 1000 / frameRate;
    const marker = `${Math.random() * 100}-${Math.random() * Date.now()}`;
    const shotsDirectory = `./allShots/shots-${marker}`;
    const videoDirectory = `./allVideos/video-${marker}.mp4`;

    deleteAllFilesInDirectoryAndCreate(shotsDirectory);

    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    console.log("Browser", browser.connected);
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(600000);

    if(!ignoreLogin){
        await page.goto(loginUrl);
        await page.type(emailInputSelector, email);
        await page.type(passwordInputSelector, password);
        await page.click(loginButtonSelector);
        await page.waitForNavigation();
    }
    

    await page.goto(videoUrl);

    console.log("Opened");
    // Wait for the element to be visible
    await page.waitForSelector(recordedElementSelector);

    // Get the bounding box of the element
    const element = await page.$(recordedElementSelector);
    const boundingBox = await element.boundingBox();

    // Capture screenshots of the element
    //const screenshots = [];

    for (let i = 0; i <= videoMiliseconds; i += loopControl) {
      // Capture 100 frames, adjust as needed
      if (i + loopControl > videoMiliseconds) {
        combineScreenshotsIntoVideo(shotsDirectory, videoDirectory);
        await browser.close();
        break;
      }

      console.log("Counter", i);

      const screenshot = await page.screenshot({
        clip: {
          x: boundingBox.x,
          y: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        },
        type: "jpeg",
        path: `${shotsDirectory}/${Date.now().toString()}.jpeg`,
      });

      await wait(loopControl);
    }

    const videoPath = path.join(videoDirectory, ``);

    const currentDomain = `${req.protocol}://${req.get("host")}`;

    const finalVideoUrl = `${currentDomain}/${videoPath}`;

    res.send(`Video created successfully! Video URL: ${finalVideoUrl}`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating video");
  }
});

async function wait(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds);
  });
}

function combineScreenshotsIntoVideo(shotsDirectory, videoDirectory) {
  // Combine screenshots into video using ffmpeg
  console.log("Combining using ffmpeg");
  exec(
    `ffmpeg -y -framerate 25 -pattern_type glob -i "${shotsDirectory}/*.jpeg" -c:v libx264 -r 25 -pix_fmt yuv420p ${videoDirectory}`,
    (error, stdout, stderr) => {
    deleteDirectory(shotsDirectory);
      if (error) {
        console.error(`ffmpeg error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`ffmpeg stderr: ${stderr}`);
        return;
      }
      console.log("Video created successfully!");

      
    }
  );
}

function deleteAllFilesInDirectoryAndCreate(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    fs.readdirSync(directoryPath).forEach((file) => {
      const filePath = path.join(directoryPath, file);
      if (fs.lstatSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    });
  } else {
    createDirectory(directoryPath);
  }
}

function createDirectory(directory) {
  const directoryPath = `${directory}`;

  try {
    fs.mkdirSync(directoryPath);
    console.log("Directory created successfully!");
  } catch (err) {
    console.error("Error creating directory:", err.message);
  }
}

function deleteDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  const files = fs.readdirSync(directoryPath);
  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    if (fs.statSync(filePath).isFile()) {
      fs.unlinkSync(filePath); // Delete the file
    }
  }

  fs.rmdirSync(directoryPath); // Delete the empty directory
}

const port = process.env.PORT || 80;
app.listen(port, () => console.log(`Server listening on port ${port}`));
