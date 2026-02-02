require('dotenv').config();
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require('discord.js');

// Web server for the website
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static('website'));
app.listen(PORT, () => {
  console.log(`Website running on port ${PORT}`);
});
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { spawn, execSync } = require('child_process');
const path = require('path');

// Paths
const ffmpegPath = require('ffmpeg-static');

// Find yt-dlp: check common locations or use PATH
function findYtDlp() {
  const { execSync } = require('child_process');
  const fs = require('fs');
  
  // Common installation paths
  const possiblePaths = [
    // Windows paths
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\yt-dlp\\yt-dlp.exe`,
    process.env.APPDATA && `${process.env.APPDATA}\\Python\\Python313\\Scripts\\yt-dlp.exe`,
    process.env.APPDATA && `${process.env.APPDATA}\\Python\\Python312\\Scripts\\yt-dlp.exe`,
    process.env.APPDATA && `${process.env.APPDATA}\\Python\\Python311\\Scripts\\yt-dlp.exe`,
    'C:\\Python313\\Scripts\\yt-dlp.exe',
    'C:\\Python312\\Scripts\\yt-dlp.exe',
    // Unix paths
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ].filter(Boolean);

  // Check if any of the paths exist
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Try to find via PATH using 'where' (Windows) or 'which' (Unix)
  try {
    const cmd = process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';
    const result = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch {
    // Not found in PATH
  }

  // Fallback to just 'yt-dlp' and hope it's in PATH
  return 'yt-dlp';
}

const ytdlpPath = findYtDlp();

console.log('FFmpeg path:', ffmpegPath);
console.log('yt-dlp path:', ytdlpPath);

// Handle uncaught errors to prevent crashes
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error.message);
});

// Bot client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Queue storage per guild
const queues = new Map();

// Get or create a queue for a guild
function getQueue(guildId) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });
    
    queues.set(guildId, {
      songs: [],
      player: player,
      connection: null,
      currentSong: null,
      isPlaying: false,
    });
  }
  return queues.get(guildId);
}

// Get video info using yt-dlp
async function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      url
    ];
    
    const proc = spawn(ytdlpPath, args);
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error('Failed to parse video info'));
        }
      } else {
        reject(new Error(stderr || 'Failed to get video info'));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// Create audio stream using yt-dlp
function createYtDlpStream(url) {
  const args = [
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '-o', '-',
    '--no-warnings',
    '--no-playlist',
    '--ffmpeg-location', ffmpegPath,
    url
  ];

  console.log('Starting yt-dlp stream...');
  
  const proc = spawn(ytdlpPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('[download]') && !msg.includes('%')) {
      console.log('yt-dlp:', msg);
    }
  });

  proc.on('error', (error) => {
    console.error('yt-dlp process error:', error.message);
  });

  proc.on('close', (code) => {
    console.log('yt-dlp process exited with code:', code);
  });

  return proc.stdout;
}

// Play the next song in queue
async function playNext(guildId) {
  const queue = getQueue(guildId);

  if (queue.songs.length === 0) {
    queue.currentSong = null;
    queue.isPlaying = false;
    console.log('Queue empty');
    return false;
  }

  const song = queue.songs.shift();
  queue.currentSong = song;
  queue.isPlaying = true;

  try {
    console.log('Playing:', song.title);
    
    const stream = createYtDlpStream(song.url);
    
    if (!stream) {
      console.error('Failed to create stream');
      return playNext(guildId);
    }

    const resource = createAudioResource(stream, {
      inlineVolume: true,
    });
    
    resource.volume?.setVolume(1);

    queue.player.play(resource);
    console.log('Audio resource created');
    return true;
  } catch (error) {
    console.error('Error playing:', error.message);
    return playNext(guildId);
  }
}

// Setup player event handlers
function setupPlayerEvents(guildId) {
  const queue = getQueue(guildId);
  queue.player.removeAllListeners();

  queue.player.on(AudioPlayerStatus.Idle, () => {
    console.log('Player idle');
    playNext(guildId);
  });

  queue.player.on(AudioPlayerStatus.Playing, () => {
    console.log('Player: PLAYING');
  });

  queue.player.on(AudioPlayerStatus.Buffering, () => {
    console.log('Player: BUFFERING');
  });

  queue.player.on('error', (error) => {
    console.error('Player error:', error.message);
    playNext(guildId);
  });
}

// Validate YouTube URL
function isValidYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/.test(url);
}

// Format duration
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play YouTube audio')
    .addStringOption(opt => opt.setName('url').setDescription('YouTube URL').setRequired(true)),
  new SlashCommandBuilder().setName('pause').setDescription('Pause'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip'),
  new SlashCommandBuilder().setName('queue').setDescription('Show queue'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Now playing'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave'),
].map(c => c.toJSON());

// Ready event
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Commands registered');
  } catch (error) {
    console.error('Error registering commands:', error.message);
  }
});

// Command handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, member } = interaction;
  console.log(`[${new Date().toISOString()}] Command: ${commandName}`);

  try {
    const queue = getQueue(guildId);
    const vc = member.voice?.channel;

    switch (commandName) {
      case 'play': {
        console.log('Play command received');
        
        if (!vc) {
          console.log('User not in voice channel');
          return interaction.reply({ content: '❌ Join a voice channel first!', flags: 64 });
        }

        console.log('Deferring reply...');
        await interaction.deferReply();
        console.log('Reply deferred');
        
        const url = interaction.options.getString('url');
        console.log('URL:', url);

        if (!isValidYouTubeUrl(url)) {
          return interaction.editReply('❌ Invalid YouTube URL');
        }

        try {
          console.log('Calling getVideoInfo...');
          const startTime = Date.now();
          const info = await getVideoInfo(url);
          console.log(`Got info in ${Date.now() - startTime}ms:`, info.title);

          const song = {
            url,
            title: info.title || 'Unknown',
            duration: formatDuration(info.duration || 0),
            thumbnail: info.thumbnail,
            requestedBy: interaction.user.tag,
          };

          // Join voice channel
          if (!queue.connection) {
            console.log('Joining:', vc.name);
            queue.connection = joinVoiceChannel({
              channelId: vc.id,
              guildId,
              adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            // Log connection state changes
            queue.connection.on('stateChange', (oldState, newState) => {
              console.log(`Voice: ${oldState.status} -> ${newState.status}`);
            });

            queue.connection.on('error', (error) => {
              console.error('Voice connection error:', error.message);
            });

            try {
              console.log('Waiting for Ready state...');
              await entersState(queue.connection, VoiceConnectionStatus.Ready, 30_000);
              console.log('Connected!');
            } catch (error) {
              console.error('Connection timeout:', error.message);
              queue.connection.destroy();
              queue.connection = null;
              return interaction.editReply('❌ Failed to join voice channel');
            }

            queue.connection.subscribe(queue.player);
            setupPlayerEvents(guildId);
            console.log('Player subscribed to connection');

            queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
              console.log('Disconnected, attempting reconnect...');
              try {
                await Promise.race([
                  entersState(queue.connection, VoiceConnectionStatus.Signalling, 5000),
                  entersState(queue.connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
              } catch {
                console.log('Reconnect failed, cleaning up');
                queue.connection?.destroy();
                queue.connection = null;
                queue.songs = [];
                queue.currentSong = null;
                queue.isPlaying = false;
              }
            });
          }

          queue.songs.push(song);

          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🎵 Added to Queue')
            .setDescription(`**${song.title}**`)
            .addFields(
              { name: 'Duration', value: song.duration, inline: true },
              { name: 'Position', value: `#${queue.songs.length}`, inline: true }
            );
          if (song.thumbnail) embed.setThumbnail(song.thumbnail);

          await interaction.editReply({ embeds: [embed] });

          if (!queue.isPlaying) playNext(guildId);
        } catch (error) {
          console.error('Error:', error.message);
          await interaction.editReply('❌ Failed to add song');
        }
        break;
      }

      case 'pause':
        if (!queue.isPlaying) return interaction.reply({ content: '❌ Nothing playing', flags: 64 });
        queue.player.pause();
        await interaction.reply('⏸️ Paused');
        break;

      case 'resume':
        if (queue.player.state.status !== AudioPlayerStatus.Paused)
          return interaction.reply({ content: '❌ Not paused', flags: 64 });
        queue.player.unpause();
        await interaction.reply('▶️ Resumed');
        break;

      case 'skip':
        if (!queue.currentSong) return interaction.reply({ content: '❌ Nothing to skip', flags: 64 });
        queue.player.stop();
        await interaction.reply(`⏭️ Skipped: **${queue.currentSong.title}**`);
        break;

      case 'queue': {
        if (!queue.currentSong && queue.songs.length === 0)
          return interaction.reply({ content: '📭 Queue empty', flags: 64 });
        
        let desc = queue.currentSong ? `**Now:** ${queue.currentSong.title}\n\n` : '';
        if (queue.songs.length > 0) {
          desc += '**Up next:**\n' + queue.songs.slice(0, 10).map((s, i) => `${i + 1}. ${s.title}`).join('\n');
        }
        
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x0099ff).setTitle('📋 Queue').setDescription(desc)]
        });
        break;
      }

      case 'nowplaying':
        if (!queue.currentSong) return interaction.reply({ content: '❌ Nothing playing', flags: 64 });
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('🎵 Now Playing')
            .setDescription(`**${queue.currentSong.title}**`)]
        });
        break;

      case 'stop':
        queue.songs = [];
        queue.currentSong = null;
        queue.isPlaying = false;
        queue.player.stop();
        await interaction.reply('⏹️ Stopped');
        break;

      case 'leave':
        if (!queue.connection) return interaction.reply({ content: '❌ Not in a channel', flags: 64 });
        queue.connection.destroy();
        queue.connection = null;
        queue.songs = [];
        queue.currentSong = null;
        queue.isPlaying = false;
        await interaction.reply('👋 Left');
        break;
    }
  } catch (error) {
    console.error('Command error:', error.message);
    try {
      if (interaction.deferred) await interaction.editReply('❌ Error');
      else if (!interaction.replied) await interaction.reply({ content: '❌ Error', flags: 64 });
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
