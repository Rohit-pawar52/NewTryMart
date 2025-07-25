const Category = require("../../models/Category");
// Create
exports.createCategory = async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.status(201).json(category);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Get All with optional filtering
exports.getAllCategories = async (req, res) => {
  try {
    const { all, search = "", limit = 10, offset = 0 } = req.query;

    const matchStage = {};
    if (all !== "true") matchStage.status = "active";
    if (search) matchStage.name = { $regex: search, $options: "i" };

    const categories = await Category.aggregate([
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      { $skip: parseInt(offset) },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "subcategories", // must match the collection name in MongoDB (usually plural)
          localField: "_id",
          foreignField: "category_id",
          as: "sub_categories"
        }
      },
      {
        $addFields: {
          sub_categories: {
            $filter: {
              input: "$sub_categories",
              as: "sub",
              cond: all === "true" ? {} : { $eq: ["$$sub.status", "active"] }
            }
          }
        }
      }
    ]);

    const total = await Category.countDocuments(matchStage);

    res.json({
      message: "Categories with subcategories fetched successfully",
      data: categories,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// exports.getAllCategories = async (req, res) => {
//   try {
//     const { all, search = "", limit = 10, offset = 0 } = req.query;

//     const filter = all === "true" ? {} : { status: "active" };

//     if (search) {
//       filter.name = { $regex: search, $options: "i" };
//     }

//     const total = await Category.countDocuments(filter);

//     const categories = await Category.find(filter)
//       .sort({ createdAt: -1 })
//       .skip(parseInt(offset))
//       .limit(parseInt(limit));

//     res.json({
//       message: "Categories fetched successfully",
//       data: categories,
//       total,
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       totalPages: Math.ceil(total / limit),
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// Get One
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ msg: "Category not found" });
    res.json(category);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Update
exports.updateCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(category);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete
exports.deleteCategory = async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ msg: "Category deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
