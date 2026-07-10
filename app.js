var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');
const sequelizeInstance = require('./config/database');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
const paymentRouter = require('./routes/payment');
const transactionsRouter = require('./routes/transactions');
const analyticsRouter = require('./routes/analytics');
const vipRouter = require('./routes/vip');
const setupRouter = require('./routes/setup');
const VippaymentsRouter = require('./routes/viptransactions');
const manualRouter = require('./routes/manual');
const viplogsRouter = require('./routes/viplogs');
const confeeRouter = require('./routes/confee');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/payment', paymentRouter);
app.use('/transactions', transactionsRouter);
app.use('/analytics', analyticsRouter);
app.use('/vip', vipRouter);
app.use('/setup', setupRouter);
app.use('/vippayments', VippaymentsRouter);
app.use('/manual', manualRouter);
app.use('/viplogs', viplogsRouter);
app.use('/confee', confeeRouter);


if (typeof paymentRouter.startPendingChargesCron === 'function') {
  paymentRouter.startPendingChargesCron();
}

sequelizeInstance.sync()
  .then(() => {
    console.log('Database sync completed successfully.');
  })
  .catch((err) => {
    console.error('Database sync failed:', err);
  });

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
