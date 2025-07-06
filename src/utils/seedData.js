const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function seed() {
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) console.log('Seeding database...');

  let prisma;
  try {
    prisma = new PrismaClient();
  } catch (error) {
    console.error('Failed to initialize Prisma Client for seeding:', error);
    throw error;
  }
  
  try {
    // Check if database already has data
    const userCount = await prisma.user.count();
    
    if (userCount > 0) {
      if (isDev) console.log('Database already has data. Skipping seed operation.');
      await prisma.$disconnect();
      return {
        usersCount: userCount,
        notesCount: await prisma.note.count(),
        skipped: true
      };
    }
    
    // Clean database
    await prisma.noteVersion.deleteMany();
    await prisma.note.deleteMany();
    await prisma.user.deleteMany();
    
    if (isDev) console.log('Database cleaned');
    
    // Create 5 users
    const users = [];
    
    for (let i = 1; i <= 5; i++) {
      const user = await prisma.user.create({
        data: {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          password: await bcrypt.hash('Password123!', 12)
        }
      });
      
      users.push(user);
      if (isDev) console.log(`Created user: ${user.email}`);
      
      // Create 4-6 notes per user
      const notesCount = Math.floor(Math.random() * 3) + 4; // Random number between 4-6
      
      for (let j = 1; j <= notesCount; j++) {
        const isProtected = j % 4 === 0; // Every 4th note is protected
        const note = await prisma.note.create({
          data: {
            title: `Note ${j} by User ${i}`,
            description: `Content for note ${j}\nCreated by User ${i}\nThis is a sample note with some content.`,
            isProtected,
            password: isProtected 
              ? await bcrypt.hash('notePassword', 12) 
              : null,
            ownerId: user.id
          }
        });
        
        // Create initial version
        await prisma.noteVersion.create({
          data: {
            title: note.title,
            description: note.description,
            noteId: note.id
          }
        });
        
        if (isDev) console.log(`Created note: ${note.title}`);
      }
    }
    
    if (isDev) {
      console.log('Seeding complete!');
      console.log(`Created ${users.length} users and ${await prisma.note.count()} notes.`);
    }
    
    return {
      usersCount: users.length,
      notesCount: await prisma.note.count()
    };
    
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    await prisma.$disconnect().catch(err => {
      console.error('Error disconnecting Prisma:', err);
    });
  }
}

// If the script is run directly, execute the seed function
if (require.main === module) {
  seed().catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
}

module.exports = seed; 