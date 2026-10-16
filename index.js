// Killua BOT — Node.js / discord.js 14
// Requires Node.js 20+, ffmpeg, and the Discord Message Content + Server Members intents.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ChannelType
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus,
  VoiceConnectionStatus, entersState, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const root = __dirname;
const env = (key, fallback = '0') => process.env[key] ?? fallback;
const cfg = {
  welcome: env('WELCOME_CHANNEL_ID', '1548009119925932102'),
  suggestions: env('SUGGESTIONS_CHANNEL_ID', '1554053646071889961'),
  announcements: env('ANNOUNCEMENTS_CHANNEL_ID', '1554087458088685619'),
  autoRole: env('AUTO_ROLE_ID', '1520945137885384757'),
  tempVoice: env('TEMP_VC_CREATE_CHANNEL_ID'),
  tempTrigger: env('TEMP_VC_TRIGGER_CHANNEL_ID', '1558227286933774477'),
  voiceChannel: env('VOICE_CHANNEL_ID', '1520945138984288349'),
  logJoin: env('LOG_JOIN_CHANNEL_ID', '1554050110579802223'),
  logMessage: env('LOG_MESSAGE_CHANNEL_ID', '1554050329534922852'),
  logModeration: env('LOG_MODERATION_CHANNEL_ID', '1554050481616191560'),
  logRole: env('LOG_ROLE_CHANNEL_ID', '1554050639032619058'),
  logVoice: env('LOG_VOICE_CHANNEL_ID', '1554050818762604554'),
  logServer: env('LOG_SERVER_CHANNEL_ID', '1554053198891720764'),
  logMusic: env('LOG_MUSIC_CHANNEL_ID', '1558227058168041554'),
};
const files = { warnings: 'warnings.json', music: 'music_data.json', features: 'advanced_features.json', logs: 'logs_config.json' };
const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); } catch { return fallback; } };
const write = (name, data) => {
  const target = path.join(root, name), tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, target);
};
const warnings = read(files.warnings, {});
const musicData = read(files.music, { songs: {}, volumes: {}, autoplay: {} });
const featureData = read(files.features, { guilds: {}, profiles: {} });
const logData = read(files.logs, {});
const queues = new Map();
const tempRooms = new Map();
const tempOwners = new Map();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildInvites], partials: [Partials.Message, Partials.Channel] });

const option = {
  member: (b, name = 'member', desc = 'العضو') => b.addUserOption(o => o.setName(name).setDescription(desc).setRequired(true)),
  text: (b, name, desc, required = true) => b.addStringOption(o => o.setName(name).setDescription(desc).setRequired(required)),
  channel: (b, name = 'channel') => b.addChannelOption(o => o.setName(name).setDescription('الروم').addChannelTypes(ChannelType.GuildText)),
  voiceChannel: (b, name = 'channel') => b.addChannelOption(o => o.setName(name).setDescription('الروم الصوتي').addChannelTypes(ChannelType.GuildVoice)),
  integer: (b, name, desc, min = 0, max = 1000, required = true) => b.addIntegerOption(o => o.setName(name).setDescription(desc).setMinValue(min).setMaxValue(max).setRequired(required)),
};
const cmd = (name, description, build = b => b, handler, defaultPerms) => {
  const b = build(new SlashCommandBuilder().setName(name).setDescription(description));
  if (defaultPerms) b.setDefaultMemberPermissions(defaultPerms);
  commands.push({ data: b, handler });
};
const commands = [];
const reply = (i, content, ephemeral = true) => i.reply({ content, ephemeral });
// Match the Python data layout: section -> guild ID -> user ID.
const guildStore = (section, guildId) => ((featureData[section] ??= {})[guildId] ??= {});
const userStore = (guildId, userId) => (((featureData.profiles[guildId] ??= {})[userId] ??= { messages: 0 }));
function log(guild, channelId, title, description, color = 0x5865f2) {
  const channel = guild?.channels.cache.get(String(channelId));
  if (channel?.isTextBased()) channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()] }).catch(() => {});
}
function logChannel(guild, key, fallback) {
  const custom = logData[guild.id]?.[key]; return String(custom || fallback || '0');
}
function audioState(guildId) {
  if (!queues.has(guildId)) queues.set(guildId, { tracks: [], current: null, player: createAudioPlayer(), repeat: false, volume: Number(musicData.volumes[guildId] ?? 100) / 100 });
  return queues.get(guildId);
}
function applyVolume(state) {
  const resource = state.player.state.resource;
  if (resource?.volume) resource.volume.setVolume(state.volume);
}
async function startTrack(guild, track) {
  const state = audioState(guild.id); state.current = track;
  const stream = await play.stream(track.url);
  state.player.play(createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true }));
  applyVolume(state);
  log(guild, logChannel(guild, 'music', cfg.logMusic), '🎵 تشغيل أغنية', `**${track.title}**`);
  state.player.once(AudioPlayerStatus.Idle, async () => {
    if (state.repeat && state.current) return startTrack(guild, state.current);
    const next = state.tracks.shift();
    if (next) await startTrack(guild, next).catch(console.error);
    else if (musicData.autoplay[guild.id] && musicData.songs[guild.id]?.length) {
      const saved = musicData.songs[guild.id][Math.floor(Math.random() * musicData.songs[guild.id].length)];
      await startTrack(guild, { title: saved.title, url: saved.webpage_url, duration: saved.duration }).catch(console.error);
    } else state.current = null;
  });
}
async function welcomeImage(member) {
  const width = 1000, height = 340, canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  try { const bg = await loadImage(path.join(root, 'ZA.png')); ctx.drawImage(bg, 0, 0, width, height); }
  catch { const grad = ctx.createLinearGradient(0, 0, width, height); grad.addColorStop(0, '#252850'); grad.addColorStop(1, '#111320'); ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height); }
  ctx.fillStyle = 'rgba(8, 10, 20, .48)'; ctx.fillRect(0, 0, width, height);
  const avatar = await loadImage(member.user.displayAvatarURL({ extension: 'png', size: 256 }));
  ctx.save(); ctx.beginPath(); ctx.arc(500, 125, 82, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); ctx.drawImage(avatar, 418, 43, 164, 164); ctx.restore();
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = 'bold 42px sans-serif'; ctx.fillText(member.displayName.slice(0, 30), 500, 255);
  ctx.font = '24px sans-serif'; ctx.fillStyle = '#d9dcff'; ctx.fillText(`مرحباً بك في ${member.guild.name}`.slice(0, 55), 500, 300);
  return canvas.toBuffer('image/png');
}
async function ensureVoice(i) {
  const member = await i.guild.members.fetch(i.user.id);
  if (!member.voice.channel) throw new Error('ادخل رومًا صوتيًا أولاً.');
  let connection = getVoiceConnection(i.guildId);
  if (!connection) connection = joinVoiceChannel({ channelId: member.voice.channelId, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: true });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  const state = audioState(i.guildId); connection.subscribe(state.player); return state;
}

// Moderation and server administration
cmd('kick', 'طرد عضو من السيرفر', b => option.text(option.member(b), 'reason', 'السبب', false), async i => {
  const m = i.options.getMember('member'); if (!m?.kickable) return reply(i, 'لا أستطيع طرد هذا العضو.');
  await m.kick(i.options.getString('reason') || 'بدون سبب'); await reply(i, `تم طرد ${m.user.tag}.`); log(i.guild, logChannel(i.guild, 'moderation', cfg.logModeration), 'طرد عضو', `${m.user.tag} بواسطة ${i.user.tag}`);
}, PermissionFlagsBits.Administrator);
cmd('ban', 'حظر عضو من السيرفر', b => option.text(option.member(b), 'reason', 'السبب', false), async i => {
  const m = i.options.getMember('member'); if (!m?.bannable) return reply(i, 'لا أستطيع حظر هذا العضو.');
  await m.ban({ reason: i.options.getString('reason') || 'بدون سبب' }); await reply(i, `تم حظر ${m.user.tag}.`); log(i.guild, logChannel(i.guild, 'moderation', cfg.logModeration), 'حظر عضو', `${m.user.tag} بواسطة ${i.user.tag}`, 0xed4245);
}, PermissionFlagsBits.Administrator);
cmd('clear', 'حذف الرسائل', b => option.integer(b, 'amount', 'عدد الرسائل', 1, 100), async i => { const n = i.options.getInteger('amount'); const msgs = await i.channel.bulkDelete(n, true); await reply(i, `حُذفت ${msgs.size} رسالة.`); }, PermissionFlagsBits.Administrator);
cmd('timeout', 'إعطاء عضو تايم أوت', b => option.integer(option.member(b), 'minutes', 'المدة بالدقائق', 1, 40320), async i => { const m = i.options.getMember('member'); await m.timeout(i.options.getInteger('minutes') * 60_000, 'بواسطة أمر البوت'); await reply(i, `تم إعطاء ${m.user.tag} تايم أوت.`); }, PermissionFlagsBits.ModerateMembers);
cmd('untimeout', 'فك التايم أوت عن عضو', b => option.member(b), async i => { await i.options.getMember('member').timeout(null); await reply(i, 'تم فك التايم أوت.'); }, PermissionFlagsBits.ModerateMembers);
cmd('warn', 'تحذير عضو', b => option.text(option.member(b), 'reason', 'السبب'), async i => {
  const m = i.options.getMember('member'), reason = i.options.getString('reason'), key = i.guildId;
  const rows = (warnings[m.id] ??= []); rows.push({ reason, moderator_id: i.user.id, time: new Date().toISOString() }); write(files.warnings, warnings);
  await reply(i, `تم تحذير ${m.user.tag}.`); log(i.guild, logChannel(i.guild, 'moderation', cfg.logModeration), 'تحذير عضو', `${m.user.tag}: ${reason}`);
}, PermissionFlagsBits.ModerateMembers);
cmd('warnings', 'عرض تحذيرات عضو', b => b.addUserOption(o => o.setName('member').setDescription('العضو (اختياري)')), async i => { const u = i.options.getUser('member') || i.user; if (u.id !== i.user.id && !i.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) return reply(i, 'يمكنك عرض تحذيراتك فقط.'); const list = warnings[u.id] || []; await reply(i, list.length ? list.slice(-10).map((w, n) => `${Math.max(list.length - 9, 1) + n}. ${w.reason} (${new Date(w.time).toLocaleDateString('ar')})`).join('\n') : 'لا توجد تحذيرات.'); });
cmd('lock', 'قفل الروم الحالي', b => b, async i => { await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false }); await reply(i, 'تم قفل الروم.'); }, PermissionFlagsBits.ManageChannels);
cmd('unlock', 'فتح الروم الحالي', b => b, async i => { await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null }); await reply(i, 'تم فتح الروم.'); }, PermissionFlagsBits.ManageChannels);
cmd('slowmode', 'تحديد وضع Slowmode للروم', b => option.integer(b, 'seconds', 'عدد الثواني', 0, 21600), async i => { await i.channel.setRateLimitPerUser(i.options.getInteger('seconds')); await reply(i, 'تم تحديث Slowmode.'); }, PermissionFlagsBits.ManageChannels);
cmd('say', 'إرسال رسالة باسم البوت', b => option.text(option.channel(b), 'text', 'نص الرسالة'), async i => { const ch = i.options.getChannel('channel') || i.channel; await ch.send(i.options.getString('text')); await reply(i, 'تم إرسال الرسالة.'); }, PermissionFlagsBits.Administrator);
cmd('announce', 'إرسال إعلان منظم', b => option.text(option.text(b, 'title', 'العنوان'), 'message', 'نص الإعلان'), async i => { const e = new EmbedBuilder().setColor(0xfee75c).setTitle(i.options.getString('title')).setDescription(i.options.getString('message')).setTimestamp(); const ch = i.guild.channels.cache.get(cfg.announcements); await (ch || i.channel).send({ embeds: [e] }); await reply(i, 'تم إرسال الإعلان.'); }, PermissionFlagsBits.Administrator);

// Community and information
cmd('suggest', 'إرسال اقتراح للسيرفر', b => option.text(b, 'text', 'اكتب اقتراحك'), async i => { const ch = i.guild.channels.cache.get(cfg.suggestions) || i.channel; const msg = await ch.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('اقتراح جديد').setDescription(i.options.getString('text')).setFooter({ text: `بواسطة ${i.user.tag}` })] }); await msg.react('👍'); await msg.react('👎'); await reply(i, 'تم إرسال اقتراحك.'); });
cmd('userinfo', 'معلومات عن عضو', b => b.addUserOption(o => o.setName('member').setDescription('العضو').setRequired(false)), async i => { const u = i.options.getUser('member') || i.user, m = await i.guild.members.fetch(u.id); await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(u.tag).setThumbnail(u.displayAvatarURL()).addFields({ name: 'الآيدي', value: u.id }, { name: 'انضم للسيرفر', value: m.joinedAt?.toLocaleDateString('ar') || 'غير معروف' })] }); });
cmd('serverinfo', 'معلومات عن السيرفر', b => b, async i => { const g = i.guild; await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(g.name).setThumbnail(g.iconURL()).addFields({ name: 'الأعضاء', value: `${g.memberCount}`, inline: true }, { name: 'القنوات', value: `${g.channels.cache.size}`, inline: true }, { name: 'تأسس', value: g.createdAt.toLocaleDateString('ar'), inline: true })] }); });
cmd('avatar', 'عرض صورة عضو', b => b.addUserOption(o => o.setName('member').setDescription('العضو').setRequired(false)), async i => { const u = i.options.getUser('member') || i.user; await i.reply({ embeds: [new EmbedBuilder().setTitle(`صورة ${u.tag}`).setImage(u.displayAvatarURL({ size: 1024 }))] }); });
cmd('help', 'عرض أوامر البوت', b => b, async i => { await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('أوامر Killua BOT').setDescription(commands.map(c => `/${c.data.name}`).join(' • '))], ephemeral: true }); });

// Music playback, saved songs, queue controls
cmd('play', 'تشغيل أغنية (اسم أو رابط يوتيوب)', b => option.text(b, 'query', 'اسم الأغنية أو الرابط'), async i => {
  await i.deferReply(); const state = await ensureVoice(i), query = i.options.getString('query');
  const result = await play.search(query, { limit: 1 }); if (!result.length) return i.editReply('لم أجد الأغنية.');
  const track = { title: result[0].title, url: result[0].url, duration: result[0].durationInSec };
  if (state.current) state.tracks.push(track); else await startTrack(i.guild, track);
  musicData.songs[i.guildId] ??= []; write(files.music, musicData); await i.editReply(`🎵 ${state.current ? 'أُضيفت للقائمة' : 'بدأ التشغيل'}: **${track.title}**`);
});
cmd('skip', 'تخطي الأغنية الحالية', b => b, async i => { const s = audioState(i.guildId); if (!s.current) return reply(i, 'لا توجد أغنية تعمل.'); s.player.stop(); await reply(i, 'تم التخطي.'); });
cmd('pause', 'إيقاف الأغنية مؤقتاً', b => b, async i => { audioState(i.guildId).player.pause(); await reply(i, 'تم الإيقاف المؤقت.'); });
cmd('resume', 'متابعة تشغيل الأغنية', b => b, async i => { audioState(i.guildId).player.unpause(); await reply(i, 'تمت المتابعة.'); });
cmd('stop', 'إيقاف التشغيل وتفريغ القائمة', b => b, async i => { const s = audioState(i.guildId); s.tracks = []; s.current = null; s.player.stop(); getVoiceConnection(i.guildId)?.destroy(); await reply(i, 'توقف التشغيل وغادر البوت الروم.'); });
cmd('queue', 'عرض قائمة الانتظار', b => b, async i => { const s = audioState(i.guildId); await reply(i, `${s.current ? `▶️ ${s.current.title}\n` : ''}${s.tracks.map((t, n) => `${n + 1}. ${t.title}`).join('\n') || 'القائمة فارغة.'}`, false); });
cmd('nowplaying', 'عرض الأغنية الحالية', b => b, async i => { const t = audioState(i.guildId).current; await reply(i, t ? `🎵 ${t.title}` : 'لا توجد أغنية تعمل.'); });
cmd('repeat', 'تكرار الأغنية الحالية', b => b.addBooleanOption(o => o.setName('enabled').setDescription('تشغيل التكرار').setRequired(true)), async i => { const s = audioState(i.guildId); s.repeat = i.options.getBoolean('enabled'); await reply(i, `التكرار ${s.repeat ? 'مفعّل' : 'متوقف'}.`); });
cmd('volume', 'تغيير مستوى الصوت (0–200)', b => option.integer(b, 'level', 'مستوى الصوت', 0, 200), async i => { const s = audioState(i.guildId); s.volume = i.options.getInteger('level') / 100; applyVolume(s); musicData.volumes[i.guildId] = i.options.getInteger('level'); write(files.music, musicData); await reply(i, `الصوت: ${i.options.getInteger('level')}٪`); });
cmd('saved_list', 'عرض الأغاني المحفوظة', b => b, async i => { const list = musicData.songs[i.guildId] || []; await reply(i, list.length ? list.map((x, n) => `${n + 1}. ${x.title}`).join('\n').slice(0, 1900) : 'لا توجد أغانٍ محفوظة.', false); });
cmd('saved_add', 'حفظ أغنية في القائمة الدائمة', b => option.text(b, 'query', 'اسم الأغنية أو الرابط'), async i => { await i.deferReply({ ephemeral: true }); const found = await play.search(i.options.getString('query'), { limit: 1 }); if (!found.length) return i.editReply('لم أجد الأغنية.'); (musicData.songs[i.guildId] ??= []).push({ title: found[0].title, webpage_url: found[0].url, duration: found[0].durationInSec }); write(files.music, musicData); await i.editReply(`تم حفظ **${found[0].title}**.`); }, PermissionFlagsBits.ManageGuild);
cmd('saved_play', 'تشغيل أغنية محفوظة', b => option.text(b, 'title', 'اسم الأغنية المحفوظة أو رقمها'), async i => { const list = musicData.songs[i.guildId] || [], key = i.options.getString('title'), track = /^\d+$/.test(key) ? list[Number(key) - 1] : list.find(x => x.title.toLowerCase() === key.toLowerCase()); if (!track) return reply(i, 'لم أجد الأغنية المحفوظة.'); await ensureVoice(i); const s = audioState(i.guildId), item = { title: track.title, url: track.webpage_url, duration: track.duration }; if (s.current) s.tracks.push(item); else await startTrack(i.guild, item); await reply(i, `تمت إضافة **${item.title}** للتشغيل.`); });

// Voice room and profile features
cmd('join', 'دخول رومك الصوتي', b => b, async i => { await ensureVoice(i); await reply(i, 'دخلت الروم الصوتي.'); });
cmd('leave', 'خروج البوت من الروم الصوتي', b => b, async i => { getVoiceConnection(i.guildId)?.destroy(); await reply(i, 'غادرت الروم الصوتي.'); }, PermissionFlagsBits.MoveMembers);
cmd('profile', 'عرض بروفايل العضو', b => b.addUserOption(o => o.setName('member').setDescription('العضو').setRequired(false)), async i => { const u = i.options.getUser('member') || i.user, p = userStore(i.guildId, u.id), rep = guildStore('rep', i.guildId)[u.id]?.points || 0; await i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`بروفايل ${u.username}`).setThumbnail(u.displayAvatarURL()).setDescription(p.bio || 'لا توجد نبذة.').addFields({ name: 'الرسائل', value: `${p.messages || 0}`, inline: true }, { name: 'السمعة', value: `${rep}`, inline: true })] }); });
cmd('setbio', 'تغيير نبذتك', b => option.text(b, 'bio', 'النبذة الجديدة'), async i => { userStore(i.guildId, i.user.id).bio = i.options.getString('bio').slice(0, 300); write(files.features, featureData); await reply(i, 'تم تحديث النبذة.'); });
cmd('rep', 'إعطاء عضو نقطة سمعة', b => option.member(b), async i => { const u = i.options.getUser('member'); if (u.id === i.user.id) return reply(i, 'لا يمكنك إعطاء نفسك سمعة.'); const p = guildStore('rep', i.guildId); p[u.id] ??= { points: 0 }; p[u.id].points++; write(files.features, featureData); await reply(i, `أضفت نقطة سمعة لـ ${u.username}.`); });
cmd('afk', 'تفعيل حالة AFK', b => option.text(b, 'reason', 'سبب الغياب', false), async i => { const data = guildStore('afk', i.guildId); data[i.user.id] = { reason: i.options.getString('reason') || 'غير متوفر حالياً', since: Math.floor(Date.now() / 1000) }; write(files.features, featureData); await reply(i, 'تم تفعيل AFK.'); });
cmd('joinstats', 'إحصائيات السيرفر', b => b, async i => { const s = guildStore('join_stats', i.guildId), today = new Date().toISOString().slice(0, 10); await i.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('👤 إحصائيات الانضمام').addFields({ name: 'الأعضاء الآن', value: `${i.guild.memberCount}`, inline: true }, { name: 'إجمالي الانضمامات', value: `${s.total_joins || 0}`, inline: true }, { name: 'انضمامات اليوم', value: `${s.daily?.[today] || 0}`, inline: true })] }); });
cmd('panel', 'لوحة التحكم الصوتية المؤقتة', b => b, async i => { const ch = i.member.voice.channel; if (!ch || !tempRooms.has(ch.id) || tempOwners.get(ch.id) !== i.user.id) return reply(i, 'ادخل رومك الصوتي المؤقت أولاً.'); await i.reply({ content: `إدارة **${ch.name}**`, ephemeral: true, components: [{ type: 1, components: [{ type: 2, style: 2, label: 'قفل', custom_id: 'temp:lock' }, { type: 2, style: 2, label: 'فتح', custom_id: 'temp:unlock' }, { type: 2, style: 2, label: 'إخفاء', custom_id: 'temp:hide' }, { type: 2, style: 2, label: 'إظهار', custom_id: 'temp:show' }, { type: 2, style: 1, label: 'تغيير الاسم', custom_id: 'temp:rename' }] }, { type: 1, components: [{ type: 2, style: 1, label: 'حد الأعضاء', custom_id: 'temp:limit' }, { type: 2, style: 1, label: 'طرد عضو', custom_id: 'temp:kick' }, { type: 2, style: 1, label: 'نقل الملكية', custom_id: 'temp:transfer' }, { type: 2, style: 4, label: 'حذف الروم', custom_id: 'temp:delete' }] }] }); });
cmd('setup_logs', 'إعداد رومات السجلات', b => b, async i => { await i.deferReply({ ephemeral: true }); const keys = ['join','messages','moderation','roles','voice','server','music']; const result = {}; for (const key of keys) result[key] = (await i.guild.channels.create({ name: `log-${key}`, type: ChannelType.GuildText })).id; logData[i.guildId] = result; write(files.logs, logData); await i.editReply('تم إنشاء قنوات السجلات وربطها.'); }, PermissionFlagsBits.Administrator);

// Remaining command families from the Python bot.
cmd('unban', 'فك الحظر عن عضو', b => option.text(b, 'user_id', 'آيدي العضو'), async i => { const id = i.options.getString('user_id'); await i.guild.members.unban(id, 'بواسطة أمر البوت'); await reply(i, `تم فك الحظر عن ${id}.`); }, PermissionFlagsBits.BanMembers);
cmd('move', 'نقل عضو إلى روم صوتي', b => option.voiceChannel(option.member(b)), async i => { const m = i.options.getMember('member'), ch = i.options.getChannel('channel'); if (!m.voice.channel) return reply(i, 'العضو ليس في روم صوتي.'); await m.voice.setChannel(ch); await reply(i, `تم نقل ${m.user.tag} إلى ${ch}.`); }, PermissionFlagsBits.MoveMembers);
cmd('mute', 'كتم عضو في الفويس', b => option.member(b), async i => { await i.options.getMember('member').voice.setMute(true); await reply(i, 'تم كتم العضو صوتياً.'); }, PermissionFlagsBits.MuteMembers);
cmd('unmute', 'فك كتم عضو في الفويس', b => option.member(b), async i => { await i.options.getMember('member').voice.setMute(false); await reply(i, 'تم فك الكتم الصوتي.'); }, PermissionFlagsBits.MuteMembers);
cmd('vc', 'إدارة الفويس (move/mute/unmute/join/leave)', b => b.addStringOption(o => o.setName('action').setDescription('الإجراء').setRequired(true).addChoices({name:'نقل عضو',value:'move'},{name:'كتم عضو',value:'mute'},{name:'فك كتم',value:'unmute'},{name:'دخول الروم',value:'join'},{name:'خروج البوت',value:'leave'})).addUserOption(o => o.setName('member').setDescription('عضو اختياري').setRequired(false)).addChannelOption(o => o.setName('channel').setDescription('روم صوتي اختياري').addChannelTypes(ChannelType.GuildVoice)), async i => {
  const action = i.options.getString('action'), member = i.options.getMember('member'), channel = i.options.getChannel('channel');
  if (action === 'join') { if (!channel && !i.member.voice.channel) return reply(i, 'حدد رومًا صوتيًا أو ادخل رومًا أولاً.'); const ch = channel || i.member.voice.channel; const old = getVoiceConnection(i.guildId); if (old) old.destroy(); joinVoiceChannel({ channelId: ch.id, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator }); return reply(i, `دخلت ${ch}.`); }
  if (action === 'leave') { getVoiceConnection(i.guildId)?.destroy(); return reply(i, 'غادرت الروم.'); }
  if (!member?.voice.channel) return reply(i, 'حدد عضواً موجوداً في روم صوتي.');
  if (action === 'move') { const target = channel || i.member.voice.channel; if (!target) return reply(i, 'حدد روم النقل.'); await member.voice.setChannel(target); }
  else if (action === 'mute') await member.voice.setMute(true);
  else if (action === 'unmute') await member.voice.setMute(false);
  else return reply(i, 'القيمة المتاحة: move أو mute أو unmute أو join أو leave.');
  await reply(i, 'تم تنفيذ أمر الفويس.');
}, PermissionFlagsBits.MoveMembers);
cmd('volume_up', 'رفع صوت البوت 10٪', b => b, async i => { const s = audioState(i.guildId); s.volume = Math.min(2, s.volume + .1); applyVolume(s); musicData.volumes[i.guildId] = Math.round(s.volume * 100); write(files.music, musicData); await reply(i, `الصوت الآن ${musicData.volumes[i.guildId]}٪`); });
cmd('volume_down', 'خفض صوت البوت 10٪', b => b, async i => { const s = audioState(i.guildId); s.volume = Math.max(0, s.volume - .1); applyVolume(s); musicData.volumes[i.guildId] = Math.round(s.volume * 100); write(files.music, musicData); await reply(i, `الصوت الآن ${musicData.volumes[i.guildId]}٪`); });
cmd('autoplay', 'تشغيل أو إيقاف الانتقال التلقائي', b => b.addBooleanOption(o => o.setName('enabled').setDescription('تشغيل').setRequired(true)), async i => { musicData.autoplay[i.guildId] = i.options.getBoolean('enabled'); write(files.music, musicData); await reply(i, `التشغيل التلقائي ${musicData.autoplay[i.guildId] ? 'مفعّل' : 'متوقف'}.`); });
cmd('saved_remove', 'حذف أغنية من القائمة المحفوظة', b => option.text(b, 'title', 'اسم الأغنية أو رقمها'), async i => { const list = musicData.songs[i.guildId] || [], key = i.options.getString('title'), n = /^\d+$/.test(key) ? Number(key) - 1 : list.findIndex(x => x.title.toLowerCase() === key.toLowerCase()); if (n < 0 || !list[n]) return reply(i, 'لم أجد الأغنية المحفوظة.'); const [removed] = list.splice(n, 1); write(files.music, musicData); await reply(i, `حُذفت **${removed.title}**.`); }, PermissionFlagsBits.ManageGuild);
cmd('saved_search', 'البحث داخل الأغاني المحفوظة', b => option.text(b, 'query', 'كلمة أو جزء من الاسم'), async i => { const q = i.options.getString('query').toLowerCase(), matches = (musicData.songs[i.guildId] || []).filter(t => t.title.toLowerCase().includes(q)); await reply(i, matches.length ? matches.slice(0, 20).map((t, n) => `${n + 1}. ${t.title}`).join('\n') : 'لم أجد نتائج.', true); });
cmd('saved_reorder', 'تغيير ترتيب الأغاني المحفوظة', b => option.integer(option.integer(b, 'from', 'موضع الأغنية الحالي', 1, 100), 'to', 'الموضع الجديد', 1, 100), async i => { const songs = musicData.songs[i.guildId] || [], from = i.options.getInteger('from') - 1, to = i.options.getInteger('to') - 1; if (!songs[from] || to >= songs.length) return reply(i, 'المواضع غير صالحة.'); const [song] = songs.splice(from, 1); songs.splice(to, 0, song); write(files.music, musicData); await reply(i, `تم نقل الأغنية إلى الموضع ${to + 1}.`); }, PermissionFlagsBits.ManageGuild);
cmd('music_panel', 'إرسال لوحة الموسيقى', b => b, async i => { const e = new EmbedBuilder().setTitle('🎵 لوحة الموسيقى').setDescription('استخدم الأزرار للتحكم بالتشغيل أو الأوامر الصوتية لإضافة الأغاني.'); await i.channel.send({ embeds: [e], components: [{ type: 1, components: [{ type: 2, style: 1, label: 'تخطي', custom_id: 'music:skip' }, { type: 2, style: 2, label: 'إيقاف مؤقت', custom_id: 'music:pause' }, { type: 2, style: 2, label: 'متابعة', custom_id: 'music:resume' }, { type: 2, style: 2, label: 'القائمة', custom_id: 'music:queue' }, { type: 2, style: 4, label: 'إيقاف', custom_id: 'music:stop' }] }] }); await reply(i, 'تم إرسال لوحة الموسيقى.'); }, PermissionFlagsBits.ManageGuild);
cmd('setbanner', 'تعيين رابط Banner للبروفايل', b => option.text(b, 'url', 'رابط صورة'), async i => { const url = i.options.getString('url'); if (!/^https?:\/\//i.test(url)) return reply(i, 'أدخل رابط http أو https صالحاً.'); userStore(i.guildId, i.user.id).banner = url; write(files.features, featureData); await reply(i, 'تم حفظ رابط البانر.'); });
cmd('profile_card', 'إنشاء Profile Card', b => b.addUserOption(o => o.setName('member').setDescription('العضو').setRequired(false)), async i => { const u = i.options.getUser('member') || i.user, p = userStore(i.guildId, u.id), canvas = createCanvas(1000, 400), ctx = canvas.getContext('2d'); let bg = null; if (p.banner) try { bg = await loadImage(p.banner); } catch {} if (bg) ctx.drawImage(bg, 0, 0, 1000, 400); else { const g = ctx.createLinearGradient(0, 0, 1000, 400); g.addColorStop(0, '#272b55'); g.addColorStop(1, '#10121d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 1000, 400); } ctx.fillStyle = 'rgba(8,10,20,.62)'; ctx.fillRect(0, 0, 1000, 400); const avatar = await loadImage(u.displayAvatarURL({ extension: 'png', size: 256 })); ctx.save(); ctx.beginPath(); ctx.arc(170, 190, 95, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(avatar, 75, 95, 190, 190); ctx.restore(); ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 42px sans-serif'; ctx.fillText(u.username.slice(0, 24), 310, 130); ctx.font = '26px sans-serif'; ctx.fillStyle = '#d9dcff'; ctx.fillText((p.bio || 'لا توجد نبذة').slice(0, 45), 310, 190); ctx.fillText(`الرسائل: ${p.messages || 0}  •  المستوى: ${Math.floor((p.messages || 0) / 100) + 1}`, 310, 255); await i.reply({ files: [{ attachment: canvas.toBuffer('image/png'), name: 'profile_card.png' }] }); });
cmd('warnlog', 'عرض سجل تحذيرات عضو', b => option.member(b), async i => { const list = warnings[i.options.getUser('member').id] || []; await reply(i, list.length ? list.map((w, n) => `${n + 1}. ${w.reason} — <@${w.moderator_id}> (${new Date(w.time).toLocaleString('ar')})`).join('\n').slice(0, 1900) : 'لا توجد تحذيرات.'); });
cmd('antiraid', 'تفعيل أو تعطيل حماية الرايد', b => b.addBooleanOption(o => o.setName('enabled').setDescription('تشغيل الحماية').setRequired(true)).addIntegerOption(o => o.setName('threshold').setDescription('عدد المنضمين').setMinValue(2).setMaxValue(100).setRequired(false)).addIntegerOption(o => o.setName('window').setDescription('النافذة بالثواني').setMinValue(2).setMaxValue(60).setRequired(false)), async i => { const s = guildStore('anti_raid', i.guildId); Object.assign(s, { enabled: i.options.getBoolean('enabled'), threshold: i.options.getInteger('threshold') || 8, window: i.options.getInteger('window') || 10 }); write(files.features, featureData); await reply(i, `الحماية ${s.enabled ? 'مفعّلة' : 'متوقفة'} (${s.threshold} أعضاء / ${s.window} ثوانٍ).`); }, PermissionFlagsBits.Administrator);
cmd('social_add', 'إضافة موجز RSS اجتماعي', b => option.channel(option.text(option.text(b, 'platform', 'youtube/twitch/kick/instagram'), 'url', 'رابط RSS أو Feed'), 'channel'), async i => { const feeds = (guildStore('social', i.guildId).feeds ??= []); feeds.push({ platform: i.options.getString('platform'), url: i.options.getString('url'), channel_id: i.options.getChannel('channel').id, last: '' }); write(files.features, featureData); await reply(i, 'تمت إضافة الموجز.'); }, PermissionFlagsBits.ManageGuild);
cmd('social_list', 'عرض الموجزات الاجتماعية', b => b, async i => { const feeds = guildStore('social', i.guildId).feeds || []; await reply(i, feeds.length ? feeds.map((f, n) => `${n + 1}. ${f.platform}: ${f.url} → <#${f.channel_id}>`).join('\n').slice(0, 1900) : 'لا توجد موجزات.'); });
cmd('social_remove', 'حذف موجز اجتماعي برقم', b => option.integer(b, 'index', 'الرقم', 1, 100), async i => { const feeds = guildStore('social', i.guildId).feeds || [], n = i.options.getInteger('index') - 1; if (!feeds[n]) return reply(i, 'الرقم غير صحيح.'); feeds.splice(n, 1); write(files.features, featureData); await reply(i, 'تم حذف الموجز.'); }, PermissionFlagsBits.ManageGuild);
cmd('voiceleaderboard', 'ترتيب الأعضاء حسب ساعات الفويس', b => b, async i => { const rows = Object.entries(guildStore('voice', i.guildId)).sort((a, b) => (b[1].seconds || 0) - (a[1].seconds || 0)).slice(0, 10); await reply(i, rows.map(([id, x], n) => `${n + 1}. <@${id}> — ${Math.floor((x.seconds || 0) / 3600)} ساعة`).join('\n') || 'لا توجد بيانات بعد.', false); });
cmd('whoami', 'عرض إحصائيات العضو', b => b.addUserOption(o => o.setName('member').setDescription('العضو').setRequired(false)), async i => { const u = i.options.getUser('member') || i.user, p = userStore(i.guildId, u.id), rep = guildStore('rep', i.guildId)[u.id]?.points || 0, voice = guildStore('voice', i.guildId)[u.id]?.seconds || 0, streak = guildStore('streak', i.guildId)[u.id]?.current || 0; await i.reply({ embeds: [new EmbedBuilder().setTitle(`إحصائيات ${u.username}`).setThumbnail(u.displayAvatarURL()).addFields({ name: 'الرسائل', value: `${p.messages || 0}`, inline: true }, { name: 'السمعة', value: `${rep}`, inline: true }, { name: 'المستوى', value: `${Math.floor((p.messages || 0) / 100) + 1}`, inline: true }, { name: 'الفويس (ساعات)', value: `${Math.floor(voice / 3600)}`, inline: true }, { name: 'الستريك', value: `${streak}`, inline: true })] }); });
cmd('card', 'فتح صندوق بطاقة', b => b, async i => { const p = guildStore('cards', i.guildId), owner = (p[i.user.id] ??= { cards: [] }), pool = [['بطاقة مبتدئ','Common','🟩',55],['بطاقة مغامر','Common','🟦',25],['بطاقة نادرة','Rare','🟪',12],['بطاقة نخبة','Rare','🔷',5],['بطاقة ملحمية','Epic','🟨',2],['بطاقة أسطورية','Legendary','🟥',1]].flatMap(x => Array(x[3]).fill(x)), [name, rarity, icon] = pool[Math.floor(Math.random() * pool.length)], id = Math.random().toString(36).slice(2, 10); owner.cards.push({ id, name, rarity, icon, at: Date.now() }); write(files.features, featureData); await reply(i, `🃏 **${name}** ${icon} — ${rarity} — ID: \`${id}\``); });
cmd('cards', 'عرض بطاقاتك', b => b, async i => { const cards = guildStore('cards', i.guildId)[i.user.id]?.cards || []; await reply(i, cards.map(c => `[${c.id}] ${c.icon || '🃏'} ${c.name} — ${c.rarity || ''}`).join('\n') || 'لا توجد بطاقات بعد.'); });
cmd('cardtrade', 'تداول بطاقة مع عضو', b => option.text(option.member(b), 'card_id', 'ID البطاقة'), async i => { const target = i.options.getUser('member'); if (target.id === i.user.id) return reply(i, 'لا يمكنك التداول مع نفسك.'); const store = guildStore('cards', i.guildId), mine = (store[i.user.id]?.cards || []), theirs = ((store[target.id] ??= { cards: [] }).cards), at = mine.findIndex(c => c.id === i.options.getString('card_id')); if (at < 0) return reply(i, 'لم أجد البطاقة عندك.'); const [card] = mine.splice(at, 1); theirs.push(card); write(files.features, featureData); await reply(i, `تم نقل ${card.name} إلى ${target.username}.`); });
cmd('streak', 'عرض الستريك اليومي', b => b.addUserOption(o => o.setName('member').setDescription('العضو').setRequired(false)), async i => { const u = i.options.getUser('member') || i.user, x = guildStore('streak', i.guildId)[u.id] || { current: 0, best: 0 }; await reply(i, `🔥 ${u.username}: الحالي ${x.current || 0} يوم، الأفضل ${x.best || 0} يوم.`); });
cmd('streak_freeze', 'حفظ تجميد يوم للستريك', b => b, async i => { const store = guildStore('streak', i.guildId), x = (store[i.user.id] ??= { current: 0, best: 0 }); if (x.freeze) return reply(i, 'استخدمت التجميد مسبقاً.'); x.freeze = 1; write(files.features, featureData); await reply(i, 'تم حفظ يوم تجميد.'); });
const dashboardRows = () => [{ type: 1, components: [{ type: 2, style: 1, label: 'الإدارة', custom_id: 'dash:moderation' }, { type: 2, style: 1, label: 'الموسيقى', custom_id: 'dash:music' }, { type: 2, style: 1, label: 'الأعضاء', custom_id: 'dash:members' }, { type: 2, style: 1, label: 'المجتمع', custom_id: 'dash:community' }, { type: 2, style: 2, label: 'كل الأوامر', custom_id: 'dash:all' }] }];
const dashboardEmbed = section => { const groups = { moderation: ['kick','ban','unban','clear','timeout','untimeout','warn','warnings','warnlog','lock','unlock','slowmode','say','announce'], music: ['play','queue','nowplaying','skip','pause','resume','stop','volume','volume_up','volume_down','autoplay','repeat','saved_add','saved_remove','saved_play','saved_list','saved_search','saved_reorder'], members: ['profile','profile_card','setbio','setbanner','rep','afk','joinstats','whoami','voiceleaderboard','card','cards','cardtrade','streak','streak_freeze','panel','verify'], community: ['suggest','suggest_decide','antiraid','social_add','social_list','social_remove','serverinfo','userinfo','avatar'] }; const names = section === 'all' ? commands.map(c => c.data.name) : groups[section] || []; return new EmbedBuilder().setColor(0x5865f2).setTitle(section === 'all' ? 'كل أوامر البوت' : `لوحة التحكم — ${section}`).setDescription(names.map(n => `/${n}`).join(' • ').slice(0, 4000)); };
cmd('setup_dashboard', 'إعداد قناة لوحة التحكم', b => b, async i => { const ch = await i.guild.channels.create({ name: '⚙️・لوحة-التحكم', type: ChannelType.GuildText }); await ch.send({ embeds: [dashboardEmbed('all')], components: dashboardRows() }); await reply(i, `تم إنشاء اللوحة: ${ch}.`); }, PermissionFlagsBits.Administrator);
cmd('dashboard', 'لوحة تحكم أنظمة البوت', b => b, async i => { await i.reply({ embeds: [dashboardEmbed('all')], components: dashboardRows(), ephemeral: true }); }, PermissionFlagsBits.ManageGuild);
cmd('suggest_decide', 'قبول أو رفض اقتراح', b => option.text(option.text(option.text(b, 'message_id', 'ID الرسالة'), 'decision', 'accept أو reject'), 'reason', 'السبب'), async i => { const msg = await i.channel.messages.fetch(i.options.getString('message_id')).catch(() => null); if (!msg) return reply(i, 'لم أجد الرسالة في هذا الروم.'); const decision = i.options.getString('decision').toLowerCase(); await msg.reply(`القرار: ${decision === 'accept' ? 'مقبول ✅' : 'مرفوض ❌'}\nالسبب: ${i.options.getString('reason')}\nبواسطة: ${i.user}`); await reply(i, 'تم تحديث الاقتراح.'); }, PermissionFlagsBits.ManageMessages);

// Verification buttons replacing the persistent discord.py view.
cmd('verify', 'إرسال أزرار التوثيق', b => b, async i => { await i.channel.send({ content: 'اختر جنسك للتوثيق:', components: [{ type: 1, components: [{ type: 2, style: 1, label: 'ذكر', emoji: { name: '👨' }, custom_id: 'verify_male' }, { type: 2, style: 4, label: 'أنثى', emoji: { name: '👩' }, custom_id: 'verify_female' }] }] }); await reply(i, 'تم إرسال أزرار التوثيق.'); }, PermissionFlagsBits.Administrator);

const raidBuckets = new Map(), voiceSessions = new Map(), inviteCache = new Map();
const streakDates = new Map();

client.once('ready', async () => {
  console.log(`جاهز: ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try { inviteCache.set(guild.id, await guild.invites.fetch()); } catch { inviteCache.set(guild.id, new Map()); }
    for (const channel of guild.channels.cache.values()) if (channel.type === ChannelType.GuildVoice && channel.name.startsWith('🔊 ')) {
      const owner = channel.permissionOverwrites.cache.find(o => o.type === 1 && o.allow.has(PermissionFlagsBits.ManageChannels));
      if (owner) { tempRooms.set(channel.id, true); tempOwners.set(channel.id, owner.id); }
    }
  }
  const startChannel = client.channels.cache.get(cfg.voiceChannel);
  if (startChannel?.type === ChannelType.GuildVoice && !getVoiceConnection(startChannel.guildId)) {
    try { joinVoiceChannel({ channelId: startChannel.id, guildId: startChannel.guildId, adapterCreator: startChannel.guild.voiceAdapterCreator }); }
    catch (error) { console.warn('تعذر دخول روم الفويس الافتراضي:', error.message); }
  }
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.data.toJSON()) });
    console.log(`تم تسجيل ${commands.length} أمر Slash`);
  } catch (error) { console.error('فشل تسجيل الأوامر:', error); }
});
client.on('interactionCreate', async i => {
  if (i.isButton() && i.customId.startsWith('dash:')) { const section = i.customId.slice(5); return i.reply({ embeds: [dashboardEmbed(section)], ephemeral: true }); }
  if (i.isButton() && i.customId.startsWith('temp:')) {
    const channel = i.member.voice.channel;
    if (!channel || !tempRooms.has(channel.id) || tempOwners.get(channel.id) !== i.user.id) return i.reply({ content: 'هذه اللوحة لصاحب الروم المؤقت فقط.', ephemeral: true });
    if (['temp:rename','temp:limit','temp:kick','temp:transfer'].includes(i.customId)) { const mode = i.customId.slice(5), labels = { rename: 'الاسم الجديد', limit: 'الحد (0 لإزالة الحد)', kick: 'آيدي العضو', transfer: 'آيدي المالك الجديد' }; return i.showModal({ custom_id: `temp_modal:${mode}`, title: labels[mode], components: [{ type: 1, components: [{ type: 4, custom_id: 'value', label: labels[mode], style: 1, min_length: 1, max_length: mode === 'rename' ? 80 : 22, required: true }] }] }); }
    if (i.customId === 'temp:lock') await channel.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: false });
    if (i.customId === 'temp:unlock') await channel.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: null });
    if (i.customId === 'temp:hide') await channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false });
    if (i.customId === 'temp:show') await channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: null });
    if (i.customId === 'temp:delete') { tempRooms.delete(channel.id); tempOwners.delete(channel.id); await channel.delete(); return i.reply({ content: 'تم حذف الروم المؤقت.', ephemeral: true }); }
    return i.reply({ content: 'تم تحديث الروم.', ephemeral: true });
  }
  if (i.isModalSubmit() && i.customId.startsWith('temp_modal:')) {
    const channel = i.member.voice.channel;
    if (!channel || !tempRooms.has(channel.id) || tempOwners.get(channel.id) !== i.user.id) return i.reply({ content: 'هذه اللوحة لصاحب الروم المؤقت فقط.', ephemeral: true });
    const value = i.fields.getTextInputValue('value');
    if (i.customId.endsWith('rename')) await channel.setName(value);
    else if (i.customId.endsWith('limit')) { const limit = Number(value); if (!Number.isInteger(limit) || limit < 0 || limit > 99) return i.reply({ content: 'الحد يجب أن يكون رقماً من 0 إلى 99.', ephemeral: true }); await channel.setUserLimit(limit); }
    else { const target = await i.guild.members.fetch(value).catch(() => null); if (!target) return i.reply({ content: 'تعذر العثور على العضو في هذا السيرفر.', ephemeral: true }); if (i.customId.endsWith('kick')) { if (target.voice.channelId !== channel.id) return i.reply({ content: 'العضو ليس في رومك.', ephemeral: true }); await target.voice.disconnect('طرد من الروم المؤقت'); } else { await channel.permissionOverwrites.edit(i.user.id, { ManageChannels: false, MoveMembers: false }); await channel.permissionOverwrites.edit(target.id, { ManageChannels: true, MoveMembers: true, Connect: true, ViewChannel: true }); tempOwners.set(channel.id, target.id); } }
    return i.reply({ content: 'تم تحديث الروم.', ephemeral: true });
  }
  if (i.isButton() && i.customId.startsWith('music:')) {
    const state = audioState(i.guildId);
    if (i.customId === 'music:skip') state.player.stop();
    else if (i.customId === 'music:pause') state.player.pause();
    else if (i.customId === 'music:resume') state.player.unpause();
    else if (i.customId === 'music:stop') { state.tracks = []; state.current = null; state.player.stop(); getVoiceConnection(i.guildId)?.destroy(); }
    else if (i.customId === 'music:queue') return i.reply({ content: `${state.current ? `▶️ ${state.current.title}\n` : ''}${state.tracks.map((x, n) => `${n + 1}. ${x.title}`).join('\n') || 'القائمة فارغة.'}`, ephemeral: true });
    return i.reply({ content: 'تم تنفيذ أمر الموسيقى.', ephemeral: true });
  }
  if (i.isButton() && ['verify_male', 'verify_female'].includes(i.customId)) {
    const genderRole = i.customId === 'verify_male' ? env('MALE_ROLE_ID', '1535217213001441310') : env('FEMALE_ROLE_ID', '1535217212623949885');
    try { const member = await i.guild.members.fetch(i.user.id); await member.roles.add([genderRole, env('VERIFIED_ROLE_ID', '1535217213555089439')], 'Killua BOT verification'); await i.reply({ content: '✅ تم توثيقك بنجاح.', ephemeral: true }); }
    catch { await i.reply({ content: 'تعذر إعطاؤك الرتب. تحقق من صلاحيات البوت وترتيب الرتب.', ephemeral: true }); }
    return;
  }
  if (!i.isChatInputCommand()) return;
  const entry = commands.find(c => c.data.name === i.commandName); if (!entry) return;
  try { await entry.handler(i); } catch (error) { console.error(`/${i.commandName}`, error); const msg = error.message || 'حدث خطأ أثناء تنفيذ الأمر.'; if (i.deferred || i.replied) await i.followUp({ content: msg, ephemeral: true }).catch(() => {}); else await reply(i, msg); }
});
client.on('guildMemberAdd', async member => {
  if (cfg.autoRole !== '0') await member.roles.add(cfg.autoRole).catch(() => {});
  const ch = member.guild.channels.cache.get(cfg.welcome); if (ch?.isTextBased()) { const png = await welcomeImage(member).catch(() => null); if (png) await ch.send({ content: `أهلاً ${member} في **${member.guild.name}**!`, files: [{ attachment: png, name: 'welcome.png' }] }); else await ch.send(`أهلاً ${member} في **${member.guild.name}**!`); }
  const stats = guildStore('join_stats', member.guild.id), today = new Date().toISOString().slice(0, 10); stats.total_joins = (stats.total_joins || 0) + 1; stats.daily ??= {}; stats.daily[today] = (stats.daily[today] || 0) + 1; userStore(member.guild.id, member.id).join_number = stats.total_joins;
  try { const current = await member.guild.invites.fetch(), old = inviteCache.get(member.guild.id) || new Map(), used = current.find(inv => (inv.uses || 0) > (old.get(inv.code)?.uses || 0)); inviteCache.set(member.guild.id, current); if (used) userStore(member.guild.id, member.id).invited_by = used.inviter?.id || null; } catch {}
  log(member.guild, logChannel(member.guild, 'join', cfg.logJoin), 'انضمام عضو', `${member.user.tag} انضم إلى السيرفر.`);
  const anti = guildStore('anti_raid', member.guild.id); if (anti.enabled) { const now = Date.now(), bucket = (raidBuckets.get(member.guild.id) || []).filter(t => now - t < (anti.window || 10) * 1000); bucket.push(now); raidBuckets.set(member.guild.id, bucket); if (bucket.length >= (anti.threshold || 8)) { raidBuckets.set(member.guild.id, []); const ch = member.guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(client.user).has(PermissionFlagsBits.SendMessages)); ch?.send('🚨 تم رصد دخول سريع لعدد كبير من الأعضاء.').catch(() => {}); } }
  write(files.features, featureData);
});
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (message.content.trim() === '!verify' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return message.channel.send({ content: 'اختر جنسك للتوثيق:', components: [{ type: 1, components: [{ type: 2, style: 1, label: 'ذكر', emoji: { name: '👨' }, custom_id: 'verify_male' }, { type: 2, style: 4, label: 'أنثى', emoji: { name: '👩' }, custom_id: 'verify_female' }] }] });
  }
  if (message.channelId === '1554631901778550845') {
    const canvas = createCanvas(1000, 105), ctx = canvas.getContext('2d'); ctx.strokeStyle = '#d2b99b'; ctx.globalAlpha = .78; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(65, 52); ctx.lineTo(420, 52); ctx.moveTo(580, 52); ctx.lineTo(935, 52); ctx.stroke(); ctx.beginPath(); ctx.arc(500, 52, 30, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(500, 22); ctx.lineTo(530, 52); ctx.lineTo(500, 82); ctx.lineTo(470, 52); ctx.closePath(); ctx.stroke(); await message.channel.send({ files: [{ attachment: canvas.toBuffer('image/png'), name: 'separator.png' }] }).catch(() => {});
  }
  const p = userStore(message.guildId, message.author.id); p.messages = (p.messages || 0) + 1; p.last_message = Math.floor(Date.now() / 1000);
  const afkData = guildStore('afk', message.guildId); if (afkData[message.author.id]) { delete afkData[message.author.id]; message.reply('👋 رجعت من AFK.').catch(() => {}); }
  for (const user of message.mentions.users.values()) { const afk = afkData[user.id]; if (afk) message.reply(`😴 ${user.username} حالياً AFK: ${afk.reason || 'غير متوفر'}`).catch(() => {}); }
  const streaks = guildStore('streak', message.guildId), streak = (streaks[message.author.id] ??= { current: 0, best: 0 }), today = new Date().toISOString().slice(0, 10);
  if (streak.last_day !== today) { const delta = streak.last_day ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${streak.last_day}T00:00:00Z`)) / 86400000 : 0; if (delta === 1) streak.current++; else if (delta === 2 && streak.freeze) { streak.current++; streak.freeze = 0; } else { streak.current = 1; if (delta > 1) streak.freeze = 0; } streak.last_day = today; streak.best = Math.max(streak.best || 0, streak.current); }
  if (message.channelId === cfg.tempTrigger && message.content.trim() === 'تفعيل') {
    const channel = await message.guild.channels.create({ name: `🔊 ${message.member.displayName}`, type: ChannelType.GuildVoice, permissionOverwrites: [{ id: message.guild.roles.everyone.id, allow: [PermissionFlagsBits.Connect] }, { id: message.author.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] }] });
    tempRooms.set(channel.id, true); tempOwners.set(channel.id, message.author.id); await message.member.voice.setChannel(channel).catch(() => {});
  }
  if (tempRooms.has(message.channelId) && message.member.voice.channelId !== message.channelId) return;
  write(files.features, featureData);
});
client.on('messageUpdate', (before, after) => { if (before.guild && !before.author?.bot && before.content !== after.content) log(before.guild, logChannel(before.guild, 'messages', cfg.logMessage), '✏️ تعديل رسالة', `الكاتب: ${before.author.tag}\nالروم: ${before.channel}\nقبل: ${(before.content || 'فارغة').slice(0, 900)}\nبعد: ${(after.content || 'فارغة').slice(0, 900)}`, 0xfee75c); });
client.on('voiceStateUpdate', async (before, after) => {
  if (cfg.tempVoice !== '0' && after.channelId === cfg.tempVoice) {
    const room = await after.guild.channels.create({ name: `🔊 ${after.member.displayName}`, type: ChannelType.GuildVoice, parent: after.channel.parentId || undefined, permissionOverwrites: [{ id: after.guild.roles.everyone.id, allow: [PermissionFlagsBits.Connect] }, { id: after.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] }] });
    tempRooms.set(room.id, true); tempOwners.set(room.id, after.id); await after.setChannel(room).catch(() => {});
  }
  const left = before.channel; if (left && tempRooms.has(left.id) && left.members.size === 0) { await left.delete().catch(() => {}); tempRooms.delete(left.id); tempOwners.delete(left.id); }
  const member = after.member || before.member, key = `${member.guild.id}:${member.id}`, now = Date.now();
  if (!before.channelId && after.channelId) voiceSessions.set(key, { start: now, channel: after.channelId });
  else if (before.channelId && after.channelId !== before.channelId) {
    const session = voiceSessions.get(key); if (session) { const stats = guildStore('voice', member.guild.id), rec = (stats[member.id] ??= { seconds: 0, rooms: {} }), seconds = Math.floor((now - session.start) / 1000); rec.seconds += seconds; rec.rooms[session.channel] = (rec.rooms[session.channel] || 0) + seconds; }
    if (after.channelId) voiceSessions.set(key, { start: now, channel: after.channelId }); else voiceSessions.delete(key);
    write(files.features, featureData);
  }
  if (before.channelId !== after.channelId) log(after.guild || before.guild, logChannel(after.guild || before.guild, 'voice', cfg.logVoice), 'تغيير حالة صوتية', `${after.member?.user.tag || before.member?.user.tag}: ${before.channel?.name || 'خارج الروم'} → ${after.channel?.name || 'خارج الروم'}`);
});
client.on('messageDelete', message => { if (message.guild && !message.author?.bot) log(message.guild, logChannel(message.guild, 'messages', cfg.logMessage), '🗑️ حذف رسالة', `الكاتب: ${message.author?.tag || 'غير معروف'}\nالروم: ${message.channel}\nالمحتوى: ${(message.content || 'لا يوجد نص').slice(0, 3000)}`, 0xed4245); });
client.on('guildMemberRemove', member => log(member.guild, logChannel(member.guild, 'join', cfg.logJoin), 'مغادرة عضو', `${member.user.tag} غادر السيرفر.`));
client.on('guildBanAdd', ban => log(ban.guild, logChannel(ban.guild, 'moderation', cfg.logModeration), '🔨 حظر عضو', `${ban.user.tag} (${ban.user.id})`, 0xed4245));
client.on('guildBanRemove', ban => log(ban.guild, logChannel(ban.guild, 'moderation', cfg.logModeration), '♻️ فك حظر عضو', `${ban.user.tag} (${ban.user.id})`, 0x57f287));
client.on('channelCreate', ch => { if (ch.guild) log(ch.guild, logChannel(ch.guild, 'server', cfg.logServer), 'إنشاء قناة', `${ch.name} (${ch.id})`); });
client.on('channelDelete', ch => { if (ch.guild) log(ch.guild, logChannel(ch.guild, 'server', cfg.logServer), 'حذف قناة', `${ch.name} (${ch.id})`, 0xed4245); });
client.on('roleCreate', role => log(role.guild, logChannel(role.guild, 'roles', cfg.logRole), 'إنشاء رتبة', `${role.name} (${role.id})`));
client.on('roleDelete', role => log(role.guild, logChannel(role.guild, 'roles', cfg.logRole), 'حذف رتبة', `${role.name} (${role.id})`, 0xed4245));
client.on('roleUpdate', (before, after) => log(after.guild, logChannel(after.guild, 'roles', cfg.logRole), 'تعديل رتبة', `${before.name} → ${after.name}`));
client.on('guildMemberUpdate', (before, after) => {
  const changes = [];
  if (before.nickname !== after.nickname) changes.push(`الاسم: ${before.nickname || before.user.username} → ${after.nickname || after.user.username}`);
  const added = after.roles.cache.filter(r => !before.roles.cache.has(r.id)), removed = before.roles.cache.filter(r => !after.roles.cache.has(r.id));
  if (added.size) changes.push(`رتب مضافة: ${added.map(r => r.name).join(', ')}`);
  if (removed.size) changes.push(`رتب محذوفة: ${removed.map(r => r.name).join(', ')}`);
  if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) changes.push(`حالة Timeout: ${after.communicationDisabledUntil ? `حتى ${after.communicationDisabledUntil.toLocaleString('ar')}` : 'منتهي/ملغي'}`);
  if (changes.length) log(after.guild, logChannel(after.guild, 'moderation', cfg.logModeration), 'تعديل عضو', `${after.user.tag}\n${changes.join('\n')}`, 0xfee75c);
});
client.on('channelUpdate', (before, after) => { if (before.name !== after.name || before.parentId !== after.parentId) log(after.guild, logChannel(after.guild, 'server', cfg.logServer), 'تعديل قناة', `${before.name} → ${after.name}`); });

setInterval(async () => {
  for (const guild of client.guilds.cache.values()) for (const feed of guildStore('social', guild.id).feeds || []) {
    if (!/^https?:\/\//i.test(feed.url) || !/(rss|feed|xml)/i.test(feed.url)) continue;
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(8000) }); if (!res.ok) continue;
      const xml = await res.text(), match = xml.match(/<(?:item|entry)[^>]*>[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?(?:<link[^>]*>([^<]+)<\/link>|<link[^>]+href=["']([^"']+))/i);
      if (!match) continue; const title = match[1].replace(/<[^>]+>/g, '').trim(), link = (match[2] || match[3] || '').trim(), marker = link || title;
      if (!marker || marker === feed.last) continue; const ch = guild.channels.cache.get(String(feed.channel_id));
      if (ch?.isTextBased()) { await ch.send(`📱 **${feed.platform} Update**\n**${title.slice(0, 250)}**\n${link.slice(0, 800)}`); feed.last = marker; write(files.features, featureData); }
    } catch (error) { console.warn(`RSS poll failed: ${error.message}`); }
  }
}, 120_000);

const app = express(); app.get('/', (_req, res) => res.send('Bot is running!'));
if (process.env.KEEP_ALIVE === 'true') app.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('Keep-alive web server listening'));
if (!process.env.TOKEN) { console.error('ضع TOKEN في ملف .env أو متغيرات البيئة.'); process.exit(1); }
client.login(process.env.TOKEN);
