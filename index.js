const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

function generateTrackingId() {
  const prefix = 'ODR';
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}

app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;

  if (!token) {
    return res.status(401).send({ message: 'Unauthorized Access.' });
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'Unauthorized Access.' })
  }

}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.0tgm6si.mongodb.net/?appName=Cluster0`;

app.get('/', (req, res) => {
  res.send("Chefonex in operation...");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // await client.connect();

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      next();
    };

    const db = client.db('Chefonex_DB');

    // Users APIs

    const usersCollection = db.collection('users');

    app.get('/users', verifyFBToken, async (req, res) => {
      const cursor = usersCollection.find().sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: 'User Exists' });
      }

      const newUser = {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        address: user.address,
        role: 'user',
        status: 'active',
        chefId: null,
        createdAt: new Date()
      };

      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    app.get('/users/profile', verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    app.get('/users/:email/role', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'user' });
    });

    app.patch('/users/fraud/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'fraud' } }
      );

      res.send(result);
    });

    // Favorites APIs

    const favoritesCollection = db.collection('favorites');

    app.get('/favorites', verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const result = await favoritesCollection.find({ userEmail: email }).sort({ addedTime: -1 }).toArray();
      res.send(result);
    });

    app.post('/favorites', verifyFBToken, async (req, res) => {
      const favorite = req.body;

      const exists = await favoritesCollection.findOne({
        userEmail: favorite.userEmail,
        mealId: favorite.mealId
      });

      if (exists) {
        return res.send({ inserted: false, message: 'Already added' });
      }

      const result = await favoritesCollection.insertOne(favorite);
      res.send({ inserted: true, result });
    });

    app.delete('/favorites/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const result = await favoritesCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Reviews APIs

    const reviewsCollection = db.collection('reviews');

    app.get('/reviews', async (req, res) => {
      const result = await reviewsCollection.find().sort({ reviewedAt: -1 }).toArray();
      res.send(result);
    });

    app.post('/reviews', verifyFBToken, async (req, res) => {
      const mealId = req.body.mealId;
      const reviewerEmail = req.decoded_email;

      const exists = await reviewsCollection.findOne({
        mealId,
        reviewerEmail
      });

      if (exists) {
        return res.send({ message: 'Already reviewed this meal' });
      }

      const reviewData = {
        ...req.body,
        reviewerEmail,
        reviewedAt: new Date()
      };

      const result = await reviewsCollection.insertOne(reviewData);
      res.send(result);
    });

    app.get('/reviews/:mealId', async (req, res) => {
      const mealId = req.params.mealId;
      const result = await reviewsCollection.find({ mealId }).sort({ reviewedAt: -1 }).toArray();
      res.send(result);
    });

    app.get('/my-reviews', verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const result = await reviewsCollection.find({ reviewerEmail: email }).sort({ reviewedAt: -1 }).toArray();
      res.send(result);
    });

    app.patch('/reviews/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const { rating, comment } = req.body;

      const result = await reviewsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { rating, comment } }
      );

      res.send(result);
    });

    app.delete('/reviews/:id', verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Role Requests APIs

    const roleRequestsCollection = db.collection('roleRequests');

    app.post('/role-requests', verifyFBToken, verifyAdmin, async (req, res) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });
      const { requestType } = req.body;

      const existingRequest = await roleRequestsCollection.findOne({
        userEmail: email,
        requestType,
        requestStatus: 'pending'
      });

      if (existingRequest) {
        return res.send({ message: 'Request already pending' });
      }

      const requestData = {
        userId: user._id,
        userName: user.displayName,
        userEmail: user.email,
        requestType: requestType,
        requestStatus: 'pending',
        requestTime: new Date()
      };

      const result = await roleRequestsCollection.insertOne(requestData);
      res.send(result);
    });

    app.get('/role-requests', verifyFBToken, verifyAdmin, async (req, res) => {
      const cursor = roleRequestsCollection.find().sort({ requestTime: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch('/role-requests/approve/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const request = await roleRequestsCollection.findOne({ _id: new ObjectId(id) });

      let updateUser = {};

      if (request.requestType === 'chef') {
        const chefId = 'Chef-' + Math.floor(1000 + Math.random() * 9000);
        updateUser = {
          role: 'chef',
          chefId: chefId
        };
      }

      if (request.requestType === 'admin') {
        updateUser = {
          role: 'admin'
        };
      }

      await usersCollection.updateOne(
        { email: request.userEmail },
        { $set: updateUser }
      );

      const result = await roleRequestsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { requestStatus: 'approved' } }
      );

      res.send(result);
    });

    app.patch('/role-requests/reject/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;

      const result = await roleRequestsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { requestStatus: 'rejected' } }
      );

      res.send(result);
    });

    app.get('/admin/statistics', verifyFBToken, verifyAdmin, verifyAdmin, async (req, res) => {
      const totalUsers = await usersCollection.countDocuments();

      const ordersDelivered = await ordersCollection.countDocuments({
        orderStatus: 'delivered'
      });

      const ordersPending = await ordersCollection.countDocuments({
        orderStatus: { $ne: 'delivered' }
      });

      const payments = await paymentsCollection.aggregate([
        {
          $group: {
            _id: null,
            totalPayment: { $sum: "$amount" }
          }
        }
      ]).toArray();

      const totalPaymentAmount = payments[0]?.totalPayment || 0;

      res.send({
        totalUsers,
        ordersDelivered,
        ordersPending,
        totalPaymentAmount
      });
    });

    // Meals APIs

    const mealsCollection = db.collection('meals');

    app.get("/meals", async (req, res) => {
      const {
        search = "",
        sort = "",
        page = 1,
        limit = 10
      } = req.query;

      const query = {};

      if (search) {
        query.mealName = { $regex: search, $options: "i" };
      }

      let sortOption = { postedAt: -1 };
      
      if (sort === "asc") sortOption = { mealPrice: 1 };
      if (sort === "desc") sortOption = { mealPrice: -1 };

      const skip = (Number(page) - 1) * Number(limit);

      const meals = await mealsCollection
        .find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(Number(limit))
        .toArray();

      const total = await mealsCollection.countDocuments(query);

      res.send({
        meals,
        total
      });
    });

    app.get('/meals/profile', verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const result = await mealsCollection.find({ userEmail: email }).toArray();
      res.send(result);
    });

    app.get('/meals/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.findOne(query);
      res.send(result);
    });

    

  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Chefonex running on Port: ${port}`);
})