module.exports.load = function(nqp, CodeRef, Capture, containerSpecs) {
  const Null = nqp.Null;
  let op = {};

  let Scalar, True, False, Str, Code, Mu, Any, ContainerDescriptor, Routine;

  op.p6settypes = function(types) {
    Scalar = types.content.get('Scalar');
    True = types.content.get('True');
    False = types.content.get('False');
    Str = types.content.get('Str');
    Code = types.content.get('Code');
    Mu = types.content.get('Mu');
    Any = types.content.get('Any');
    Nil = types.content.get('Nil');
    Routine = types.content.get('Routine');
    ContainerDescriptor = types.content.get('ContainerDescriptor');
    Signature = types.content.get('Signature');

    return types;
  };

  op.p6bool = function(value) {
    return value ? True : False;
  };

  op.p6definite = function(obj) {
    return (obj === Null || obj.typeObject_) ? False : True;
  };

  op.p6typecheckrv = function(ctx, rv, routine, bypassType) {
    const sig = routine.$$getattr(Code, '$!signature');
    let rtype = sig.$$getattr(Signature, '$!returns');
    if (rtype !== Null && nqp.op.objprimspec(rtype) === 0) {
      let targetType;
      const how = rtype._STable.HOW;
      const archetypes = how.archetypes(ctx, null, how);
      const isCoercive = nqp.retval_bool(ctx, archetypes.coercive(ctx, null, archetypes));

      if (isCoercive) {
        targetType = how.target_type(ctx, null, how, rtype);
        rtype = how.constraint_type(ctx, null, how, rtype);
      }

      const decontValue = rv.$$decont(ctx);
      if (decontValue.$$istype(ctx, rtype) === 0 && decontValue.$$istype(ctx, bypassType) === 0) {
        const thrower = getThrower("X::TypeCheck::Return");
        if (thrower === Null) {
            ctx.die("Type check failed for return value");
        } else {
            thrower.$$call(ctx, null, decontValue, rtype);
        }
      }

      if (targetType !== undefined && targetType !== rtype) {
        const targetTypeName = targetType._STable.HOW.name(
          ctx, null, targetType._STable.HOW, targetType).$$getStr();
        if (rv.$$can(ctx, targetTypeName)) {
          return rv[targetTypeName](ctx, null, rv);
        } else {
          const rtypeName = rtype._STable.HOW.name(ctx, null, rtype._STable.HOW, rtype).$$getStr();
          throw new nqp.NQPException(
            `Unable to coerce the return value from ${rtypeName} to ${targetTypeName} ;` +
              `no coercion method defined`);
        }
      }
    }

    return rv;
  };

  op.p6setfirstflag = function(codeObj) {
    firstPhaserCodeBlock = codeObj.$$getattr(Code, "$!do");
    return codeObj;
  };

  op.p6takefirstflag = function(ctx) {
    const matches = firstPhaserCodeBlock === ctx.codeRef();
    firstPhaserCodeBlock = Null;
    return matches ? 1 : 0;
  };

  const prePhaserFrames = [];

  op.p6setpre = function(ctx) {
    prePhaserFrames.push(ctx);
    return Null;
  };

  op.p6clearpre = function(ctx) {
    const index = prePhaserFrames.indexOf(ctx);
    if (index !== -1) {
      prePhaserFrames.splice(index, 1);
    }
    return Null;
  };

  op.p6inpre = function(ctx) {
    const index = prePhaserFrames.indexOf(ctx.$$caller);
    if (index !== -1) {
      prePhaserFrames.splice(index, 1);
      return 1;
    } else {
      return 0;
    }
  };

  op.p6captureouters2 = function(ctx, capList, target) {
    const cf = target.outerCtx;

    if (cf === Null) {
      return capList;
    }

    const elems = capList.$$elems();

    for (let i = 0; i < elems; i++) {
        const codeObj = capList.$$atpos(i);

        const closure = codeObj.$$getattr(Code, "$!do");

        const ctxToDiddle = closure.outerCtx;
        if (ctxToDiddle) {
          ctxToDiddle.$$outer = cf;
        } else {
          console.log("can't diddle", closure);
        }
    }

    return capList;
  };

  op.p6capturelex = function(ctx, codeObj) {
    const closure = codeObj.$$getattr(Code, "$!do");
    const wantedStaticInfo = closure.staticCode.outerCodeRef;

    if (ctx.codeRef().staticCode === wantedStaticInfo) {
      closure.outerCtx = ctx;
      closure.capture(closure.staticCode.freshBlock());
    } else {
      /* HACK - workaround for rakudo bugs */
      //console.log("HORRIBLE hack - p6capturelex will do nothing");
    }

    return codeObj;
  };

  op.p6capturelexwhere = function(ctx, codeObj) {
    const closure = codeObj.$$getattr(Code, "$!do");
    const wantedStaticInfo = closure.staticCode.outerCodeRef;

    let find = ctx;

    while (find) {
        if (find.codeRef().staticCode === wantedStaticInfo) {
          closure.outerCtx = find;
          closure.capture(closure.staticCode.freshBlock());
          return codeObj;
        }
        find = find.$$caller;
    }
  //  console.log("HORRIBLE hack - p6capturelexwhere will do nothing");

    return codeObj;
  };

  op.p6var = function(cont) {
    if (cont.$$iscont && cont.$$iscont()) {
      const wrapper = Scalar._STable.REPR.allocate(Scalar._STable);
      wrapper.$$bindattr(Scalar, '$!value', cont);
      return wrapper;
    } else {
      return cont;
    }
  }

  op.p6bindassert = function(ctx, value, type) {
    if (type !== Mu) {
      if (value.$$decont(ctx).$$istype(ctx, type) == 0) {
        const thrower = getThrower("X::TypeCheck::Binding");

        if (thrower === null) {
          ctx.die("Type check failed in binding");
        } else {
          thrower.$$call(ctx, null, value, type);
        }
      }
    }
    return value;
  };

  op.p6store = function(ctx, cont, value) {
    if (cont.$$assign) {
      cont.$$assign(ctx, value.$$decont(ctx));
    } else {
      if (!cont.STORE) {
        // TODO throw typed exception X::Assignment::RO
        ctx.die("Cannot assign to a non-container");
      } else {
        cont.STORE(ctx, null, cont, value);
      }
    }
    return cont;
  };

  const p6HLL = nqp.getHLL('perl6');

  op.p6argvmarray = function(ctx, args) {
    const array = [];
    for (let i=2; i < args.length; i++) {
      array[i-2] = nqp.op.hllizefor(ctx, nqp.arg(p6HLL, args[i]), 'perl6');
    }
    return nqp.createArray(array);
  };

  op.p6decodelocaltime = function(sinceEpoch) {
    let date = new Date(sinceEpoch * 1000);

    return nqp.createIntArray([
      date.getSeconds(),
      date.getMinutes(),
      date.getHours(),
      date.getDate(),
      date.getMonth()+1,
      date.getFullYear()
    ]);
  }

  op.p6finddispatcher = function(ctx, usage) {
    let dispatcher;
    let search = ctx.$$caller;
    while (search) {
      /* Do we have a dispatcher here? */
      if (search.hasOwnProperty("$*DISPATCHER") && search["$*DISPATCHER"] !== Null) {
        dispatcher = search["$*DISPATCHER"];
        if (dispatcher.typeObject_) {
          dispatcher = dispatcher.vivify_for(ctx, null, dispatcher, search.codeRef().codeObj, search, new Capture(search.$$args[1], Array.prototype.slice.call(search.$$args, 2)));
          search["$*DISPATCHER"] = dispatcher;
        }
        return dispatcher;
      }
      search = search.$$caller;
    }

    const thrower = getThrower("X::NoDispatcher");
    if (thrower === Null) {
        ctx.die(usage + ' is not in the dynamic scope of a dispatcher');
    } else {
        thrower.$$call(ctx, null, new nqp.NativeStrArg(usage));
    }

  };

  op.p6argsfordispatcher = function(ctx, dispatcher) {
    let search = ctx;
    while (search) {
      /* Do we have the dispatcher we're looking for? */
      if (search['$*DISPATCHER'] === dispatcher) {
        return new Capture(search.$$args[1], Array.prototype.slice.call(search.$$args, 2));
      }
      /* Follow dynamic chain. */
      search = search.$$caller;
    }
    throw 'Could not find arguments for dispatcher';
  };

  op.p6sink = function(ctx, obj) {
    if (obj.typeObject_ || obj === Null) return;
    if (obj.$$can(ctx, 'sink')) {
      obj.sink(ctx, null, obj);
    }
  };

  op.p6staticouter = function(ctx, codeRef) {
    if (!(codeRef instanceof CodeRef)) throw new nqp.NQPException("p6staticouter must be used on a CodeRef");
    return codeRef.staticCode.outerCodeRef;
  };

  op.p6reprname = function(obj) {
    const repr = Str._STable.REPR;
    const boxed = repr.allocate(Str._STable);
    boxed.$$setStr(nqp.op.reprname(obj));
    return boxed;
  };

  op.p6getouterctx = function(codeObj) {
    const closure = codeObj.$$getattr(Code, "$!do");
    console.log('p6getouterctx:');
    nqp.dumpObj(closure);
    console.log('returning');
    nqp.dumpObj(closure.outerCtx);
    return closure.outerCtx || Null;
  };

  op.p6invokeunder = function(ctx, currentHLL, fake, code) {
    const spec = fake._STable.invocationSpec;

    const fakeCode = fake.$$getattr(spec.classHandle, spec.attrName);

    const invokingUnder = new nqp.Ctx(ctx, fakeCode.outerCtx, fakeCode);

    return nqp.retval(currentHLL, code.$$call(invokingUnder, null));

  };

  function RakudoScalar(STable) {
    this.STable = STable;
  }

  RakudoScalar.prototype.configure = function(conf) {
    this.store = conf.content.get('store');
    this.store_unchecked = conf.content.get('store_unchecked');
    this.setupSTable();
  };

  function getThrower(type) {
    let exHash = nqp.op.gethllsym("perl6", "P6EX");
    return (exHash === Null ? Null : exHash.$$atkey(type));
  }

  RakudoScalar.prototype.setupSTable = function() {
    const store = this.store;
    const store_unchecked = this.store_unchecked;

    this.STable.addInternalMethod('$$assignunchecked', function(ctx, value) {
      store_unchecked.$$call(ctx, null, this, value);
    });

    this.STable.addInternalMethod('$$assign', function(ctx, value) {
      store.$$call(ctx, null, this, value);
    });

    this.STable.addInternalMethod('$$decont', function(ctx) {
      return this.$$getattr(Scalar, '$!value');
    });

    this.STable.addInternalMethod('$$getInt', function(ctx) {
      return this.$$getattr(Scalar, '$!value').$$getInt();
    });

    this.STable.addInternalMethod('$$getStr', function(ctx) {
      return this.$$getattr(Scalar, '$!value').$$getStr();
    });

    this.STable.addInternalMethod('$$getNum', function(ctx) {
      return this.$$getattr(Scalar, '$!value').$$getNum();
    });

    this.STable.addInternalMethod('$$iscont', function() {
      return 1;
    });

    this.STable.addInternalMethod('$$isrwcont', function() {
      if (this.typeObject_) return 0;
      let desc = this.$$getattr(Scalar, '$!descriptor');
      return desc === Null ? 0 : 1;
    });
  };




  RakudoScalar.prototype.serialize = function(cursor) {
    cursor.ref(this.store);
    cursor.ref(this.store_unchecked);
  };

  RakudoScalar.prototype.deserialize = function(cursor) {
    this.store = cursor.variant();
    this.store_unchecked = cursor.variant();
  };

  RakudoScalar.prototype.name = 'rakudo_scalar';

  containerSpecs.rakudo_scalar = RakudoScalar;

  nqp.loadOps({op: op});
};