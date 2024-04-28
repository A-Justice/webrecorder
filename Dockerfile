FROM satantime/puppeteer-node:latest

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg

COPY ./package.json .

RUN npm install

COPY . .

EXPOSE 80


CMD ["node","index.js"]


#docker build -t pup .
#docker run -it -p 80:80 -v /Users/macbook/Desktop/Desk/projects/POC/HSR/:/app -v /node_modules pup
#docker 