const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionsBitField, ChannelType, Events, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const http = require('http');

const config = {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    suggestionsChannelId: process.env.SUGGESTIONS_CHANNEL_ID,
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
    staffRoleIds: process.env.STAFF_ROLE_IDS ? process.env.STAFF_ROLE_IDS.split(',') : [],
    ticketCategoryParentId: process.env.TICKET_CATEGORY_ID,
    ratingsChannelId: process.env.RATINGS_CHANNEL_ID,
};

if (!config.token) {
    console.error('ERROR: El token del bot no está configurado en las variables de entorno (DISCORD_TOKEN).');
    process.exit(1);
}
if (!config.guildId) {
    console.warn('ADVERTENCIA: GUILD_ID no está configurado. Los comandos se registrarán globalmente.');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildInvites,
    ],
});

client.commands = new Collection();
client.invites = new Collection();
client.welcomeEnabled = new Collection();

const commandsToRegister = [];

// /sugerir
const sugerirCommand = {
    data: new SlashCommandBuilder()
        .setName('sugerir')
        .setDescription('Envía una sugerencia para el servidor.')
        .addStringOption(option =>
            option.setName('sugerencia')
                .setDescription('La sugerencia que quieres enviar.')
                .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'Este comando solo puede usarse en un servidor.', ephemeral: true });
        }

        const suggestionsChannel = interaction.guild.channels.cache.get(config.suggestionsChannelId);

        if (!suggestionsChannel) {
            console.error(`Canal de sugerencias no encontrado: ${config.suggestionsChannelId}`);
            return interaction.reply({ content: 'El canal de sugerencias no está configurado correctamente en el bot (SUGGESTIONS_CHANNEL_ID). Contacta a un administrador.', ephemeral: true });
        }

        const suggestionText = interaction.options.getString('sugerencia');
        const suggestionEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🗳️ Nueva Sugerencia')
            .setDescription(suggestionText)
            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
            .setFooter({ text: `ID de Usuario: ${interaction.user.id}` })
            .setTimestamp();

        const voteUpButton = new ButtonBuilder()
            .setCustomId('suggestion_vote_up')
            .setLabel('A favor')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const voteDownButton = new ButtonBuilder()
            .setCustomId('suggestion_vote_down')
            .setLabel('En contra')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        const voteRow = new ActionRowBuilder().addComponents(voteUpButton, voteDownButton);

        const sentMessage = await suggestionsChannel.send({
            embeds: [suggestionEmbed],
            components: [voteRow]
        });

        const acceptButton = new ButtonBuilder()
            .setCustomId(`suggestion_moderation_${sentMessage.id}_accept`)
            .setLabel('Aceptar Sugerencia')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(false);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`suggestion_moderation_${sentMessage.id}_reject`)
            .setLabel('Rechazar Sugerencia')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(false);

        const moderationRow = new ActionRowBuilder().addComponents(acceptButton, rejectButton);

        await sentMessage.edit({
            components: [voteRow, moderationRow]
        });

        await interaction.reply({ content: 'Tu sugerencia ha sido enviada para votación y moderación. ¡Gracias!', ephemeral: true });
    },
};
client.commands.set(sugerirCommand.data.name, sugerirCommand);
commandsToRegister.push(sugerirCommand.data.toJSON());

// /setup-tickets
const setupTicketsCommand = {
    data: new SlashCommandBuilder()
        .setName('setup-tickets')
        .setDescription('Configura el sistema de tickets en este canal.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'Este comando solo puede usarse en un servidor.', ephemeral: true });
        }

        const ticketEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎫 Sistema de Tickets')
            .setDescription(
                '> Selecciona una categoría para abrir tu ticket.\n> Un miembro del staff te atenderá lo antes posible.\n\n' +
                '**Categorías disponibles:**\n\n' +
                '🛠️ **Soporte Técnico** — Problemas, bugs y dudas\n' +
                '🤝 **Alianza** — Propuestas de alianza o partnership\n' +
                '🚨 **Reportes** — Reportar jugadores o incidencias'
            )
            .setFooter({ text: '⚡ Respuesta rápida garantizada por nuestro staff' })
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_category_select')
            .setPlaceholder('📂 Selecciona una categoría...')
            .addOptions(
                { label: 'Soporte Técnico', description: 'Problemas, bugs y dudas técnicas.', value: 'soporte-tecnico', emoji: '🛠️' },
                { label: 'Alianza', description: 'Propuestas de alianza o partnership.', value: 'alianza', emoji: '🤝' },
                { label: 'Reportes', description: 'Reportar jugadores o incidencias.', value: 'reportes', emoji: '🚨' },
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.channel.send({ embeds: [ticketEmbed], components: [row] });
        await interaction.reply({ content: 'El sistema de tickets ha sido configurado en este canal.', ephemeral: true });
    },
};
client.commands.set(setupTicketsCommand.data.name, setupTicketsCommand);
commandsToRegister.push(setupTicketsCommand.data.toJSON());

// /invites
const invitesCommand = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Muestra cuántas personas ha invitado un usuario.')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuario a consultar (por defecto tú mismo).')
                .setRequired(false)),
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'Este comando solo puede usarse en un servidor.', ephemeral: true });
        }

        const target = interaction.options.getUser('usuario') || interaction.user;

        try {
            const invites = await interaction.guild.invites.fetch();
            const userInvites = invites.filter(inv => inv.inviter && inv.inviter.id === target.id);

            const totalUses = userInvites.reduce((acc, inv) => acc + (inv.uses || 0), 0);
            const totalLinks = userInvites.size;

            const inviteEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📨 Estadísticas de Invitaciones')
                .setThumbnail(target.displayAvatarURL())
                .setDescription(`Invitaciones de **${target.username}** en **${interaction.guild.name}**`)
                .addFields(
                    { name: '👥 Personas invitadas', value: `**${totalUses}**`, inline: true },
                    { name: '🔗 Links activos', value: `**${totalLinks}**`, inline: true },
                )
                .setFooter({ text: `ID: ${target.id}` })
                .setTimestamp();

            if (userInvites.size > 0) {
                const linkList = userInvites
                    .map(inv => `\`${inv.code}\` — **${inv.uses}** usos (expira: ${inv.maxAge === 0 ? 'Nunca' : `<t:${Math.floor(Date.now() / 1000) + inv.maxAge}:R>`})`)
                    .slice(0, 8)
                    .join('\n');
                inviteEmbed.addFields({ name: '📋 Links de invitación', value: linkList, inline: false });
            }

            await interaction.reply({ embeds: [inviteEmbed] });

        } catch (error) {
            console.error('Error al obtener invitaciones:', error);
            if (error.code === 50013) {
                return interaction.reply({ content: 'El bot no tiene permiso de **Gestionar Servidor** para ver las invitaciones.', ephemeral: true });
            }
            await interaction.reply({ content: 'Hubo un error al obtener las invitaciones.', ephemeral: true });
        }
    },
};
client.commands.set(invitesCommand.data.name, invitesCommand);
commandsToRegister.push(invitesCommand.data.toJSON());

// --- Evento ready ---
client.once(Events.ClientReady, async () => {
    console.log(`¡Listo! Logeado como ${client.user.tag}`);

    const rest = new REST().setToken(config.token);
    try {
        console.log(`Comenzando a registrar ${commandsToRegister.length} comandos de barra.`);
        if (config.guildId) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(client.application.id, config.guildId),
                    { body: commandsToRegister },
                );
                console.log(`Se registraron exitosamente ${commandsToRegister.length} comandos en el guild ${config.guildId}.`);
            } catch (guildError) {
                console.warn(`No se pudieron registrar comandos en el guild, intentando globalmente... (${guildError.message})`);
                await rest.put(
                    Routes.applicationCommands(client.application.id),
                    { body: commandsToRegister },
                );
                console.log(`Se registraron exitosamente ${commandsToRegister.length} comandos globalmente.`);
            }
        } else {
            await rest.put(
                Routes.applicationCommands(client.application.id),
                { body: commandsToRegister },
            );
            console.log(`Se registraron exitosamente ${commandsToRegister.length} comandos globalmente.`);
        }
    } catch (error) {
        console.error('Error al registrar comandos:', error);
    }

    for (const guild of client.guilds.cache.values()) {
        if (guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            try {
                const invites = await guild.invites.fetch();
                client.invites.set(guild.id, new Collection(invites.map(invite => [invite.code, invite.uses])));
                console.log(`Invitaciones cargadas para el guild: ${guild.name}`);
            } catch (error) {
                console.error(`No se pudieron cargar las invitaciones para el guild ${guild.name}: ${error.message}`);
            }
        } else {
            console.warn(`El bot no tiene permiso 'Manage Guild' en ${guild.name} para rastrear invitaciones.`);
        }
    }
});

// --- Manejo de Interacciones ---
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No se encontró comando: ${interaction.commandName}.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error ejecutando comando ${interaction.commandName}:`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'Hubo un error al ejecutar este comando.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Hubo un error al ejecutar este comando.', ephemeral: true });
            }
        }
        return;
    }

    if (interaction.isButton()) {
        const customIdParts = interaction.customId.split('_');
        const customIdPrefix = customIdParts[0];

        if (customIdPrefix === 'suggestion') {
            const actionType = customIdParts[1];

            if (actionType === 'moderation') {
                const messageId = customIdParts[2];
                const action = customIdParts[3];

                const hasPermission = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                                      interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
                                      interaction.member.roles.cache.some(r => config.staffRoleIds.includes(r.id));

                if (!hasPermission) {
                    return interaction.reply({ content: 'No tienes permiso para interactuar con estos botones de moderación.', ephemeral: true });
                }

                try {
                    const originalMessage = await interaction.channel.messages.fetch(messageId);
                    const originalEmbed = EmbedBuilder.from(originalMessage.embeds[0]);

                    let newColor;
                    let statusText;
                    if (action === 'accept') {
                        newColor = 0x00FF00;
                        statusText = 'Aceptada';
                    } else if (action === 'reject') {
                        newColor = 0xFF0000;
                        statusText = 'Rechazada';
                    } else {
                        return interaction.reply({ content: 'Acción de moderación desconocida.', ephemeral: true });
                    }

                    const existingStatusField = originalEmbed.data.fields?.find(field => field.name === 'Estado');
                    if (existingStatusField) {
                        existingStatusField.value = `${statusText} por ${interaction.user.tag}`;
                    } else {
                        originalEmbed.addFields({ name: 'Estado', value: `${statusText} por ${interaction.user.tag}`, inline: false });
                    }

                    originalEmbed.setColor(newColor);

                    const updatedComponents = originalMessage.components.map(row => {
                        const newRow = ActionRowBuilder.from(row);
                        newRow.components.forEach(btn => btn.setDisabled(true));
                        return newRow;
                    });

                    await originalMessage.edit({ embeds: [originalEmbed], components: updatedComponents });
                    await interaction.reply({ content: `Sugerencia ${statusText.toLowerCase()} correctamente.`, ephemeral: true });

                } catch (error) {
                    console.error('Error al moderar sugerencia:', error);
                    await interaction.reply({ content: 'Hubo un error al procesar esta acción de moderación.', ephemeral: true });
                }
            } else if (actionType === 'vote') {
                const voteAction = customIdParts[2];
                await interaction.reply({ content: `Gracias por tu voto (${voteAction === 'up' ? '✅' : '❌'}).`, ephemeral: true });
            }
        } else if (customIdPrefix === 'ticket') {
            const action = customIdParts[1];

            if (action === 'claim') {
                const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                                interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                                interaction.member.roles.cache.some(r => config.staffRoleIds.includes(r.id));

                if (!isStaff) {
                    return interaction.reply({ content: 'Solo el staff puede reclamar tickets.', ephemeral: true });
                }

                // Deshabilitar el botón de reclamar y actualizar el embed
                const originalMessage = interaction.message;
                const updatedComponents = originalMessage.components.map(row => {
                    const newRow = ActionRowBuilder.from(row);
                    newRow.components.forEach(btn => {
                        if (btn.data.custom_id === 'ticket_claim') {
                            btn.setDisabled(true).setLabel(`✅ Reclamado por ${interaction.user.username}`);
                        }
                    });
                    return newRow;
                });

                await interaction.message.edit({ components: updatedComponents });
                await interaction.reply({ content: `✋ **${interaction.user}** ha reclamado este ticket y se encargará de tu solicitud.` });

            } else if (action === 'close') {
                const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                                interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                                interaction.member.roles.cache.some(r => config.staffRoleIds.includes(r.id));

                if (!isStaff) {
                    return interaction.reply({ content: 'Solo el staff puede cerrar los tickets.', ephemeral: true });
                }

                // Mostrar embed de valoración antes de cerrar
                const ratingEmbed = new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('⭐ Valoración del Ticket')
                    .setDescription(
                        '¡Antes de cerrar, por favor valora la atención recibida!\n\n' +
                        '> Tu opinión nos ayuda a mejorar la calidad del soporte.'
                    )
                    .setFooter({ text: 'El ticket se cerrará automáticamente tras valorar.' });

                const ratingRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_rate_1').setLabel('1 ⭐').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('ticket_rate_2').setLabel('2 ⭐').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('ticket_rate_3').setLabel('3 ⭐').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('ticket_rate_4').setLabel('4 ⭐').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('ticket_rate_5').setLabel('5 ⭐').setStyle(ButtonStyle.Success),
                );

                await interaction.reply({ embeds: [ratingEmbed], components: [ratingRow] });

            } else if (action === 'rate') {
                const stars = customIdParts[2];

                // Mostrar modal con campo de comentario
                const modal = new ModalBuilder()
                    .setCustomId(`ticket_comment_${stars}_${interaction.channelId}`)
                    .setTitle(`Valoración: ${'⭐'.repeat(parseInt(stars))} (${stars}/5)`);

                const commentInput = new TextInputBuilder()
                    .setCustomId('rating_comment')
                    .setLabel('Deja un comentario (opcional)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('¿Cómo fue tu experiencia con el soporte recibido?')
                    .setRequired(false)
                    .setMaxLength(500);

                modal.addComponents(new ActionRowBuilder().addComponents(commentInput));
                await interaction.showModal(modal);
            }
        }
        return;
    }

    // --- Manejo de Modales ---
    if (interaction.isModalSubmit()) {
        const parts = interaction.customId.split('_');
        if (parts[0] === 'ticket' && parts[1] === 'comment') {
            const stars = parseInt(parts[2]);
            const channelId = parts[3];
            const starText = '⭐'.repeat(stars);
            const comment = interaction.fields.getTextInputValue('rating_comment').trim();
            const ticketChannel = interaction.guild.channels.cache.get(channelId);

            await interaction.reply({ content: `${starText} ¡Gracias por tu valoración de **${stars}/5**! Cerrando el ticket en 5 segundos...`, ephemeral: true });

            // Enviar valoración al canal de valoraciones
            const ratingsChannel = interaction.guild.channels.cache.get(config.ratingsChannelId);
            if (ratingsChannel) {
                const ratingEmbed = new EmbedBuilder()
                    .setColor(stars >= 4 ? 0x2ECC71 : stars === 3 ? 0xF1C40F : 0xE74C3C)
                    .setTitle('📊 Nueva Valoración de Ticket')
                    .addFields(
                        { name: '⭐ Puntuación', value: `${starText} **${stars}/5**`, inline: true },
                        { name: '👤 Usuario', value: `${interaction.user}`, inline: true },
                        { name: '🎫 Canal', value: ticketChannel ? `#${ticketChannel.name}` : `ID: ${channelId}`, inline: true },
                    )
                    .setTimestamp()
                    .setFooter({ text: `ID: ${interaction.user.id}` });

                if (comment) {
                    ratingEmbed.addFields({ name: '💬 Comentario', value: `> ${comment}`, inline: false });
                }

                await ratingsChannel.send({ embeds: [ratingEmbed] });
            }

            // Deshabilitar botones y cerrar canal
            setTimeout(async () => {
                try {
                    if (ticketChannel) await ticketChannel.delete('Ticket cerrado tras valoración.');
                } catch (deleteError) {
                    console.error(`Error al eliminar canal de ticket ${channelId}:`, deleteError);
                }
            }, 5000);
        }
        return;
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_category_select') {
            await interaction.deferReply({ ephemeral: true });

            const category = interaction.values[0];
            const guild = interaction.guild;
            const member = interaction.member;

            let channelName = `ticket-${category}-${member.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
            if (channelName.length > 100) channelName = channelName.substring(0, 95) + '...';

            try {
                const ticketChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    topic: `Ticket de ${category} creado por ${member.user.tag} (ID: ${member.user.id})`,
                    parent: config.ticketCategoryParentId || null,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                        ...config.staffRoleIds.map(roleId => ({
                            id: roleId,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                        })),
                    ],
                });

                const categoryLabels = {
                    'soporte-tecnico': '🛠️ Soporte Técnico',
                    'alianza': '🤝 Alianza',
                    'reportes': '🚨 Reporte',
                };
                const categoryLabel = categoryLabels[category] || category;

                const ticketEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(`${categoryLabel}`)
                    .setDescription(
                        `Hola ${member}, ¡bienvenido/a a tu ticket!\n\n` +
                        '> Describe tu situación con el mayor detalle posible.\n' +
                        '> Un miembro del staff te atenderá en breve.\n\n' +
                        '**¿Cuándo cerrar el ticket?**\n' +
                        'Usa el botón de abajo cuando tu solicitud haya sido resuelta.'
                    )
                    .setFooter({ text: '⚡ Staff de LunarisMC • Tiempo de respuesta rápido' })
                    .setTimestamp();

                const closeButton = new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('🔒 Cerrar Ticket')
                    .setStyle(ButtonStyle.Danger);

                const claimButton = new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('✋ Reclamar Ticket')
                    .setStyle(ButtonStyle.Success);

                const row = new ActionRowBuilder().addComponents(claimButton, closeButton);

                const staffMention = config.staffRoleIds.length > 0 ? `<@&${config.staffRoleIds[0]}>` : '';
                await ticketChannel.send({ content: `${member} ${staffMention}`, embeds: [ticketEmbed], components: [row] });
                await interaction.followUp({ content: `Tu ticket ha sido creado en ${ticketChannel}.`, ephemeral: true });

            } catch (error) {
                console.error('Error al crear ticket:', error);
                let errorMessage = 'Hubo un error al crear tu ticket.';
                if (error.code === 50013) {
                    errorMessage += ' Parece que el bot no tiene los permisos necesarios para crear canales o configurar permisos.';
                } else if (error.code === 50001) {
                    errorMessage += ' Parece que el bot no tiene acceso a la categoría especificada o al servidor.';
                }
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            }
        }
        return;
    }
});

// --- Manejo de Mensajes (!bienvenidas) ---
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    if (message.content.toLowerCase() === '!bienvenidas') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('¡No tienes permiso para usar este comando!');
        }

        const currentStatus = client.welcomeEnabled.get(message.guild.id) || false;
        const newStatus = !currentStatus;

        client.welcomeEnabled.set(message.guild.id, newStatus);

        if (newStatus) {
            message.reply('Los mensajes de bienvenida han sido **activados** en este servidor.');
        } else {
            message.reply('Los mensajes de bienvenida han sido **desactivados** en este servidor.');
        }
    }
});

// --- Manejo de GuildMemberAdd (Bienvenidas) ---
client.on(Events.GuildMemberAdd, async member => {
    if (!member.guild) return;

    if (!client.welcomeEnabled.get(member.guild.id)) {
        return;
    }

    const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
    if (!welcomeChannel) {
        console.warn(`[ADVERTENCIA] Canal de bienvenida no encontrado para el guild ${member.guild.name} (ID: ${config.welcomeChannelId}).`);
        return;
    }

    let inviter = null;
    let inviteCode = 'desconocido';

    if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try {
            const newInvites = await member.guild.invites.fetch();
            const oldInvites = client.invites.get(member.guild.id);

            if (oldInvites) {
                const usedInvite = newInvites.find(invite => {
                    const oldUses = oldInvites.get(invite.code) || 0;
                    return invite.uses > oldUses;
                });

                if (usedInvite) {
                    inviter = usedInvite.inviter;
                    inviteCode = usedInvite.code;
                }
            }
            client.invites.set(member.guild.id, new Collection(newInvites.map(invite => [invite.code, invite.uses])));

        } catch (error) {
            console.error(`Error al obtener invitaciones para el guild ${member.guild.name}: ${error.message}`);
        }
    } else {
        console.warn(`El bot no tiene permiso 'Manage Guild' en ${member.guild.name} para rastrear invitaciones para ${member.user.tag}.`);
    }

    const welcomeEmbed = new EmbedBuilder()
        .setColor(0x28B463)
        .setTitle(`👋 ¡Bienvenido/a a ${member.guild.name}!`)
        .setDescription(`¡Hola ${member}! Nos alegra tenerte aquí. Esperamos que disfrutes tu estancia.`)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'Miembros', value: `${member.guild.memberCount}`, inline: true }
        )
        .setTimestamp();

    if (inviter) {
        welcomeEmbed.addFields({ name: 'Invitado por', value: `${inviter.tag} (Código: \`${inviteCode}\`)`, inline: true });
    } else {
        welcomeEmbed.addFields({ name: 'Invitado por', value: 'No se pudo determinar (o invitación expirada)', inline: true });
    }

    try {
        await welcomeChannel.send({ content: `¡Bienvenido, ${member}!`, embeds: [welcomeEmbed] });
    } catch (error) {
        console.error(`Error al enviar mensaje de bienvenida al canal ${welcomeChannel.id}: ${error.message}`);
    }
});

// --- Servidor HTTP para UptimeRobot ---
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot activo ✅');
});
server.listen(PORT, () => {
    console.log(`Servidor de ping activo en el puerto ${PORT}`);
});

client.login(config.token);
