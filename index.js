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
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');


// =========================
// CLIENT
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});


// =========================
// ENVIRONMENT VARIABLES
// =========================

const TOKEN = process.env.TOKEN;

const ALIVE_ROLE = process.env.ALIVE_ROLE_ID;

const ADMIN_ROLE_IDS = process.env.ADMIN_ROLE_IDS
  ? process.env.ADMIN_ROLE_IDS.split(',').map(id => id.trim())
  : [];

const READONLY_ROLE_IDS = process.env.READONLY_ROLE_IDS
  ? process.env.READONLY_ROLE_IDS.split(',').map(id => id.trim())
  : [];

const CONTROL_CHANNEL = process.env.CONTROL_CHANNEL_ID;

const ALLIANCE_CATEGORY_ID = process.env.ALLIANCE_CATEGORY_ID;

const ARCHIVE_CATEGORY_ID = process.env.ARCHIVE_CATEGORY_ID;


// =========================
// VALIDATION
// =========================

if (
  !TOKEN ||
  !ALIVE_ROLE ||
  !ADMIN_ROLE_IDS.length ||
  !CONTROL_CHANNEL ||
  !ALLIANCE_CATEGORY_ID
) {
  console.warn(
    "Warning: Missing one or more environment variables!"
  );
}


// =========================
// SLASH COMMAND REGISTRATION
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Post the Create Alliance Channel button')
    .toJSON()
];


const rest = new REST({
  version: '10'
}).setToken(TOKEN);


client.once(Events.ClientReady, async () => {

  console.log(`Logged in as ${client.user.tag}`);


  for (const guild of client.guilds.cache.values()) {

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        guild.id
      ),
      {
        body: commands
      }
    );

  }


  console.log("Slash command registered");

});


// =========================
// /SETUP
// =========================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isChatInputCommand()) return;


    if (interaction.commandName !== 'setup') return;


    const hasAdminRole =
      interaction.member.roles.cache.some(role =>
        ADMIN_ROLE_IDS.includes(role.id)
      );


    if (!hasAdminRole) {

      return interaction.reply({
        content: "Admins only.",
        ephemeral: true
      });

    }


    const button = new ButtonBuilder()
      .setCustomId('create_alliance')
      .setLabel('Create Alliance Channel')
      .setStyle(ButtonStyle.Primary);


    const row = new ActionRowBuilder()
      .addComponents(button);


    await interaction.reply({

      content:
        "Create your private alliance channel below.",

      components: [row]

    });

  }
);



// =========================
// CREATE ALLIANCE CHANNEL
// =========================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isButton()) return;

    if (interaction.customId !== 'create_alliance')
      return;


    const member = interaction.member;


    if (!member.roles.cache.some(role => role.id === ALIVE_ROLE)) {

      return interaction.reply({

        content:
          "You must be Alive to create an alliance.",

        ephemeral: true

      });

    }


    try {

      await interaction.deferReply({
        ephemeral: true
      });



      const channel =
        await interaction.guild.channels.create({

          name:
            `alliance-${interaction.user.username}`
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, ''),


          type:
            ChannelType.GuildText,


          parent:
            ALLIANCE_CATEGORY_ID,


          permissionOverwrites: [

            // Hide from everyone
            {
              id:
                interaction.guild.roles.everyone.id,

              deny: [
                PermissionFlagsBits.ViewChannel
              ]
            },


            // Alliance creator
            {
              id:
                interaction.user.id,

              allow: [

                PermissionFlagsBits.ViewChannel,

                PermissionFlagsBits.SendMessages,

                PermissionFlagsBits.ReadMessageHistory,

                PermissionFlagsBits.ManageMessages

              ]
            }

          ]

        });



      // =========================
      // ADMIN ROLE ACCESS
      // =========================

      for (const roleId of ADMIN_ROLE_IDS) {

        try {

          await channel.permissionOverwrites.edit(
            roleId,
            {

              ViewChannel: true,

              SendMessages: true,

              ReadMessageHistory: true,

              ManageMessages: true

            }
          );

        } catch (err) {

          console.error(
            `Failed adding admin role ${roleId}:`,
            err.message
          );

        }

      }



      // =========================
      // READ ONLY ROLE ACCESS
      // =========================

      for (const roleId of READONLY_ROLE_IDS) {

        try {

          await channel.permissionOverwrites.edit(
            roleId,
            {

              ViewChannel: true,

              SendMessages: false,

              ReadMessageHistory: true

            }
          );

        } catch (err) {

          console.error(
            `Failed adding readonly role ${roleId}:`,
            err.message
          );

        }

      }



      await interaction.followUp({

        content:
          `Your alliance channel has been created: ${channel}`,

        ephemeral: true

      });


      await channel.send(
        `Alliance created by ${interaction.user}`
      );


    } catch (error) {

      console.error(
        "Alliance creation error:",
        error
      );


      if (!interaction.replied) {

        await interaction.followUp({

          content:
            "Failed to create alliance channel.",

          ephemeral: true

        });

      }

    }

  }
);

// =========================
// ADD ALIVE MEMBERS BY MENTION
// =========================

client.on(
  Events.MessageCreate,
  async message => {


    if (message.author.bot) return;


    const channel = message.channel;


    // Only alliance channels
    if (
      channel.parentId !== ALLIANCE_CATEGORY_ID
    ) return;



    // Only owner can add users
    const creatorPermission =
      channel.permissionOverwrites.cache.get(
        message.author.id
      );


    if (!creatorPermission) return;



    const mentions =
      message.mentions.members;


    if (!mentions.size) return;



    for (const member of mentions.values()) {


      if (
  member.roles.cache.some(role => role.id === ALIVE_ROLE)
) {

        await channel.permissionOverwrites.edit(
          member.id,
          {

            ViewChannel: true,

            SendMessages: true,

            ReadMessageHistory: true

          }
        );

      }

    }

  }
);



// =========================
// REMOVE DEAD USERS
// =========================

client.on(
  'guildMemberUpdate',
  async (oldMember, newMember) => {


  const lostAlive =
  oldMember.roles.cache.some(role => role.id === ALIVE_ROLE) &&
  !newMember.roles.cache.some(role => role.id === ALIVE_ROLE);



    if (!lostAlive) return;



    const channels =
      newMember.guild.channels.cache;



    for (const channel of channels.values()) {


      if (
        channel.parentId !== ALLIANCE_CATEGORY_ID
      ) continue;



      await channel.permissionOverwrites
        .delete(newMember.id)
        .catch(() => {});



      // Archive if owner
      if (
        channel.name.includes(
          newMember.user.username.toLowerCase()
        )
      ) {


        if (ARCHIVE_CATEGORY_ID) {

          await channel.setParent(
            ARCHIVE_CATEGORY_ID
          );

        }


        await channel.permissionOverwrites.edit(

          newMember.guild.roles.everyone.id,

          {
            ViewChannel: false
          }

        );

      }

    }

  }
);



client.login(TOKEN);