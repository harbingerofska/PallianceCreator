require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

// Load environment variables
const TOKEN = process.env.TOKEN;
const ALIVE_ROLE = process.env.ALIVE_ROLE_ID;
const ADMIN_ROLE_IDS = process.env.ADMIN_ROLE_IDS
  ? process.env.ADMIN_ROLE_IDS.split(',') : [];
const CONTROL_CHANNEL = process.env.CONTROL_CHANNEL_ID;

// Warn if missing env
if (!TOKEN || !ALIVE_ROLE || !ADMIN_ROLE_IDS.length || !CONTROL_CHANNEL) {
  console.warn("Warning: Missing one or more .env variables!");
}

// =========================
// REGISTER SLASH COMMAND
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Post the Create Alliance Thread button')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guild.id),
      { body: commands }
    );
  }

  console.log("Slash command registered");
});

// =========================
// /setup command
// =========================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setup') {
    // Check if user has at least one admin role
    const memberRoles = interaction.member.roles.cache.map(r => r.id);
    const isAdmin = memberRoles.some(id => ADMIN_ROLE_IDS.includes(id));

    if (!isAdmin) {
      return interaction.reply({ content: "Admins only.", ephemeral: true });
    }

    const button = new ButtonBuilder()
      .setCustomId('create_thread')
      .setLabel('Create Alliance Thread')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({
      content: "Press the button below to create your private alliance thread.",
      components: [row]
    });
  }
});

// =========================
// BUTTON CLICK → CREATE THREAD
// =========================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== 'create_thread') return;

  const member = interaction.member;

  // Must be Alive
  if (!member.roles.cache.has(ALIVE_ROLE)) {
    return interaction.reply({
      content: "You must be Alive to create a thread.",
      ephemeral: true
    });
  }

  try {
    // Defer reply to prevent "This interaction failed"
    await interaction.deferReply({ ephemeral: true });

    // Create private thread
    const thread = await interaction.channel.threads.create({
      name: `alliance-${interaction.user.username}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 1440
    });

    // Add creator
    await thread.members.add(interaction.user.id);

    // Add all admins
    const admins = interaction.guild.members.cache.filter(m =>
      m.roles.cache.some(r => ADMIN_ROLE_IDS.includes(r.id))
    );

    for (const admin of admins.values()) {
      await thread.members.add(admin.id).catch(() => {});
    }

    // Follow up after deferring
    await interaction.followUp({
      content: `Your private thread has been created: ${thread}`,
      ephemeral: true
    });

    await thread.send(`Alliance thread created by ${interaction.user}`);

  } catch (err) {
    console.error("Thread creation error:", err);
    if (!interaction.replied) {
      await interaction.followUp({
        content: "An error occurred while creating your thread.",
        ephemeral: true
      });
    }
  }
});

// =========================
// ADD USERS VIA MENTION
// =========================
client.on(Events.MessageCreate, async (message) => {
  // Ignore non-threads and bots
  if (!message.channel.isThread()) return;
  if (message.author.bot) return;

  const thread = message.channel;

  if (thread.type !== ChannelType.PrivateThread) return;

  // Only the thread creator can add users
  if (message.author.id !== thread.ownerId) return;

  const mentions = message.mentions.members; // GuildMember objects
  if (!mentions.size) return;

  for (const member of mentions.values()) {
    // Only add users with Alive role
    if (member.roles.cache.has(ALIVE_ROLE)) {
      await thread.members.add(member.id).catch(err => {
        console.error(`Failed to add ${member.user.tag} to thread:`, err);
      });
    }
  }
});

// =========================
// CLEANUP ON DEATH
// =========================
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const hadAlive = oldMember.roles.cache.has(ALIVE_ROLE);
  const hasAlive = newMember.roles.cache.has(ALIVE_ROLE);

  if (!(hadAlive && !hasAlive)) return;

  const channels = newMember.guild.channels.cache;

  for (const channel of channels.values()) {
    if (!channel.isThread()) continue;
    if (channel.type !== ChannelType.PrivateThread) continue;

    // Remove user from thread
    await channel.members.remove(newMember.id).catch(() => {});

    // Lock + archive thread if user is owner
    if (channel.ownerId === newMember.id) {
      await channel.setLocked(true);
      await channel.setArchived(true);
    }
  }
});

client.login(TOKEN);